// src/anchor.ts
import { DurableObjectStub } from '@cloudflare/workers-types';
import { Env } from './types';

export type ModeState = "pending" | "confirmed" | "anchored" | "expired" | "void" | "refund";

export type AnchorJob = {
  id: string;
  receiptId: string;
  createdAt: number;
  attempts: number;
  chain: "ethereum" | "arbitrum" | "polygon" | "base";
};

export type AttestRecord = {
  id: string;
  mode: "pending" | "confirmed" | "anchored" | "expired";
  initiatorCommit: string;
  counterCommit?: string;
  final?: string;
  receivedAt: number;
  policyVersion: string;
  txHash?: string;
};

export const JOB_TTL_SEC = 60 * 60 * 24;

const DEFAULT_QUEUE_PREFIX = 'anchor:jobs:';
const DEFAULT_RECEIPT_PREFIX = 'attest:';

function jobKey(env: Env, id: string) {
  return `${env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX}${id}`;
}
function receiptKey(env: Env, id: string) {
  return `${env.RECEIPT_PREFIX || DEFAULT_RECEIPT_PREFIX}${id}`;
}

export async function enqueueAnchor(env: Env, job: AnchorJob) {
  await env.TATTLEHASH_ANCHOR_KV.put(jobKey(env, job.id), JSON.stringify(job), { expirationTtl: JOB_TTL_SEC });
}
export async function listAnchorJobs(env: Env, cursor?: string) {
  return env.TATTLEHASH_ANCHOR_KV.list({ prefix: env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX, cursor, limit: 100 });
}
export async function getJob(env: Env, id: string) {
  const raw = await env.TATTLEHASH_ANCHOR_KV.get(jobKey(env, id));
  return raw ? (JSON.parse(raw) as AnchorJob) : null;
}
export async function getReceipt(env: Env, id: string) {
  const raw = await env.ATT_KV.get(receiptKey(env, id));
  return raw ? (JSON.parse(raw) as AttestRecord) : null;
}
export async function putReceipt(env: Env, record: AttestRecord) {
  await env.ATT_KV.put(receiptKey(env, record.id), JSON.stringify(record));
}

// Chain anchoring - supports MOCK_MODE for testing
async function anchorOnChain(env: Env, job: AnchorJob, rec: AttestRecord): Promise<string> {
  // Check for mock mode (for testing without hitting real endpoints)
  const mockMode = env.ANCHOR_MODE === 'mock' || env.NODE_ENV === 'test';

  if (mockMode) {
    // Generate a deterministic mock tx hash based on receipt data
    const mockData = `mock:${rec.id}:${rec.initiatorCommit || ''}:${Date.now()}`;
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(mockData));
    return "0xmock_" + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 60);
  }

  // Relay mode - use external anchoring service
  if (env.ANCHOR_MODE === 'relay') {
    // TODO: Implement relay to external anchoring service
    // For now, generate a simulated tx hash
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return "0xrelay_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Direct mode - submit directly to blockchain via RPC
  // TODO: Implement direct RPC submission when needed
  // For now, generate a simulated tx hash
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function processOneJob(env: Env, id: string) {
  const job = await getJob(env, id);
  if (!job) return { ok: false, reason: "missing-job" };

  const rec = await getReceipt(env, job.receiptId);
  if (!rec) return { ok: false, reason: "missing-receipt" };

  if (rec.mode === "anchored") {
    await env.TATTLEHASH_ANCHOR_KV.delete(jobKey(env, id));
    return { ok: true, reason: "already-anchored" };
  }
  if (rec.mode !== "confirmed" && rec.mode !== "pending") {
    await env.TATTLEHASH_ANCHOR_KV.delete(jobKey(env, id));
    return { ok: false, reason: `invalid-state:${rec.mode}` };
  }

  // Global lock via DO to prevent double-anchoring (skip in mock mode or if DO unavailable)
  const mockMode = env.ANCHOR_MODE === 'mock' || env.NODE_ENV === 'test';
  let lock: DurableObjectStub | null = null;

  if (!mockMode && env.AnchorLock) {
    lock = env.AnchorLock.get(env.AnchorLock.idFromName("anchor-global"));
    const r = await lock.fetch("https://lock/do", { method: "POST" });
    if (!r.ok) return { ok: false, reason: "lock-busy" };
  }

  try {
    const txHash = await anchorOnChain(env, job, rec);
    rec.mode = "anchored";
    rec.txHash = txHash;
    await putReceipt(env, rec);
    await env.TATTLEHASH_ANCHOR_KV.delete(jobKey(env, id));
    return { ok: true, txHash };
  } finally {
    if (lock) {
      await lock.fetch("https://lock/release", { method: "POST" });
    }
  }
}

// Exported for reuse in your other modules if needed
export function makeReceipt(env: Env, initiatorCommit: string): AttestRecord {
  return {
    id: crypto.randomUUID(),
    mode: "pending",
    initiatorCommit,
    receivedAt: Date.now(),
    policyVersion: env.POLICY_VERSION || 'shield-v1'
  };
}
