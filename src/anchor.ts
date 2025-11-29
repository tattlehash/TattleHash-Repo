// src/anchor.ts
import { DurableObjectStub } from '@cloudflare/workers-types';
import { Env } from './types';

// Re-export storage types and functions
export {
  type ModeState,
  type AnchorJob,
  type AttestRecord,
  JOB_TTL_SEC,
  enqueueAnchor,
  listAnchorJobs,
  getJob,
  deleteJob,
  getReceipt,
  putReceipt,
  makeReceipt,
} from './anchor/storage';

// Import for local use
import {
  type AnchorJob,
  type AttestRecord,
  getJob,
  deleteJob,
  getReceipt,
  putReceipt,
} from './anchor/storage';

// Import the new anchor service
import { anchorRecord as anchorRecordService, queryTransactionStatus } from './anchor/service';

// Re-export queryTransactionStatus for use by handlers
export { queryTransactionStatus };

// Chain anchoring - delegates to anchor service
async function anchorOnChain(env: Env, job: AnchorJob, rec: AttestRecord): Promise<string> {
  const result = await anchorRecordService(env, job, rec);

  if (!result.ok || !result.txHash) {
    throw new Error(result.error || 'Anchor submission failed');
  }

  return result.txHash;
}

export async function processOneJob(env: Env, id: string) {
  const job = await getJob(env, id);
  if (!job) return { ok: false, reason: "missing-job" };

  const rec = await getReceipt(env, job.receiptId);
  if (!rec) return { ok: false, reason: "missing-receipt" };

  if (rec.mode === "anchored") {
    await deleteJob(env, id);
    return { ok: true, reason: "already-anchored" };
  }
  if (rec.mode !== "confirmed" && rec.mode !== "pending") {
    await deleteJob(env, id);
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
    await deleteJob(env, id);
    return { ok: true, txHash };
  } finally {
    if (lock) {
      await lock.fetch("https://lock/release", { method: "POST" });
    }
  }
}
