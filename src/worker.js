// src/worker.js — TattleHash Worker (consolidated, hardened router)
//
// Preserves existing routes + adds async anchoring endpoints (/attest, /confirm, /status),
// a cron scheduler to sweep queued jobs, and a Durable Object global lock.
// Reuses existing KVs: ATT_KV (receipts) and TATTLEHASH_ANCHOR_KV (jobs).
//
// NOTE: Requires wrangler.toml updates you already made:
//   [triggers] crons = ["*/2 * * * *"]
//   [durable_objects] bindings = [{ name="AnchorLock", class_name="AnchorLock" }]
//   [[migrations]] tag="anchor-lock-v1" new_classes=["AnchorLock"]
//   [vars] POLICY_VERSION, QUEUE_PREFIX, RECEIPT_PREFIX

import { handleGatekeeperCreate, handleGateVerify, handleGateGet } from './gatekeeper.js';
import { handleShieldScan } from './shield.js';
import { stripeCancel } from './utils/stripe.js';
import { handleTraceGet, handleKvList, handleEcho, handleTime } from './debug.js';
// Keep your existing anchor routes; these remain available.
import { handleAnchorTrigger, handleAnchorProcess } from './anchor.js';

/* -------------------- Small framework: headers, errors, utils -------------------- */

function baseHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, idempotency-key",
    // basic security hygiene
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-version": "tattlehash-worker/2025-11-06",
    ...extra,
  };
}
const ok = (obj, init = {}) => {
  const rid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const hdrs = baseHeaders({ ...(init.headers || {}), "x-request-id": rid });
  return new Response(JSON.stringify(obj), { ...init, headers: hdrs });
};
const err = (status, code, extras = {}) => ok({ ok: false, error: code, ...extras }, { status });

const E = {
  MISSING_SECRET: "missing_secret",
  MISSING_KV: "missing_kv",
  RATE_LIMITED: "rate_limited",
  EXPIRED: "expired",
  NOT_FOUND: "not_found",
  INTERNAL: "internal_error",
};

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
async function safeJson(req) {
  const reader = req.body?.getReader?.();
  if (!reader) return {};
  let received = 0;
  const chunks = [];
  // read stream safely
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(value);
  }
  const bytes = new Uint8Array(received); let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("invalid_json"); }
}

function log(obj) {
  try { console.log(JSON.stringify({ t: Date.now(), ...obj })); } catch {}
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",")}}`;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, msgHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const msgBytes = hexToBytes(msgHex);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// fixed-window rate limit in KV
async function rateLimit(kv, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const rk = `${key}:${bucket}`;
  const current = Number(await kv.get(rk)) || 0;
  if (current >= limit) return true;
  await kv.put(rk, String(current + 1), { expirationTtl: windowSec + 5 });
  return false;
}

/* ---------------------- Async Anchoring (inlined, no import) --------------------- */
/* Reuses:
     env.ATT_KV                 // attestation receipts
     env.TATTLEHASH_ANCHOR_KV   // job queue
   Requires (with sane defaults if missing):
     env.POLICY_VERSION (default "shield-v1")
     env.QUEUE_PREFIX  (default "anchor:jobs:")
     env.RECEIPT_PREFIX(default "attest:")
*/

function aQueuePrefix(env)  { return env.QUEUE_PREFIX  || "anchor:jobs:"; }
function aReceiptPrefix(env){ return env.RECEIPT_PREFIX || "attest:"; }
const JOB_TTL_SEC = 60 * 60 * 24; // 24h

function ajobKey(env, id)    { return `${aQueuePrefix(env)}${id}`; }
function receiptKey(env, id) { return `${aReceiptPrefix(env)}${id}`; }

async function enqueueAnchor(env, job) {
  await env.TATTLEHASH_ANCHOR_KV.put(ajobKey(env, job.id), JSON.stringify(job), { expirationTtl: JOB_TTL_SEC });
}
async function listAnchorJobs(env, cursor) {
  return env.TATTLEHASH_ANCHOR_KV.list({ prefix: aQueuePrefix(env), cursor, limit: 100 });
}
async function getJob(env, id) {
  const raw = await env.TATTLEHASH_ANCHOR_KV.get(ajobKey(env, id));
  return raw ? JSON.parse(raw) : null;
}
async function getReceipt(env, id) {
  const raw = await env.ATT_KV.get(receiptKey(env, id));
  return raw ? JSON.parse(raw) : null;
}
async function putReceipt(env, record) {
  await env.ATT_KV.put(receiptKey(env, record.id), JSON.stringify(record));
}
function makeReceipt(env, initiatorCommit) {
  return {
    id: crypto.randomUUID(),
    mode: "pending",
    initiatorCommit,
    receivedAt: Date.now(),
    policyVersion: env.POLICY_VERSION || "shield-v1",
  };
}
// Stub chain write — replace with real JSON-RPC call(s)
async function anchorOnChain(/* env, job, rec */) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function processOneJob(env, id) {
  const job = await getJob(env, id);
  if (!job) return { ok: false, reason: "missing-job" };

  const rec = await getReceipt(env, job.receiptId);
  if (!rec) {
    await env.TATTLEHASH_ANCHOR_KV.delete(ajobKey(env, id));
    return { ok: false, reason: "missing-receipt" };
  }

  if (rec.mode === "anchored") {
    await env.TATTLEHASH_ANCHOR_KV.delete(ajobKey(env, id));
    return { ok: true, reason: "already-anchored" };
  }
  if (rec.mode !== "confirmed" && rec.mode !== "pending") {
    await env.TATTLEHASH_ANCHOR_KV.delete(ajobKey(env, id));
    return { ok: false, reason: `invalid-state:${rec.mode}` };
  }

  // Global lock via DO to prevent double-anchoring
  const lock = env.AnchorLock.get(env.AnchorLock.idFromName("anchor-global"));
  const r = await lock.fetch("https://lock/do", { method: "POST" });
  if (!r.ok) return { ok: false, reason: "lock-busy" };

  try {
    const txHash = await anchorOnChain(env, job, rec);
    rec.mode = "anchored";
    rec.txHash = txHash;
    await putReceipt(env, rec);
    await env.TATTLEHASH_ANCHOR_KV.delete(ajobKey(env, id));
    return { ok: true, txHash };
  } finally {
    await lock.fetch("https://lock/release", { method: "POST" });
  }
}

/* --------------------------------- Router table --------------------------------- */

const routes = [
  // Core
  { method: "POST", pathExact: "/gatekeeper", handler: handleGatekeeperCreate },
  { method: "POST", pathPrefix: "/gate/", handler: handleGateVerify },
  { method: "GET",  pathPrefix: "/gate/", handler: handleGateGet },

  // Shield
  { method: "POST", pathExact: "/shield/scan", handler: handleShieldScan },

  // Anchoring (legacy/new you already had)
  { method: "POST", pathPrefix: "/anchor/",              handler: handleAnchorTrigger },
  { method: "POST", pathExact:  "/debug/anchor/process", handler: handleAnchorProcess },

  // NEW: Async Anchoring public endpoints
  { method: "POST", pathExact: "/attest",  handler: postAttest },   // create + enqueue
  { method: "POST", pathExact: "/confirm", handler: postConfirm },  // pending → confirmed
  { method: "GET",  pathExact: "/status",  handler: getStatus },    // state lookup

  // Attestations (legacy API you had before)
  { method: "POST", pathExact: "/attestations", handler: postAttestations },

  // Debug / helpers (dev-only; handlers also self-check env)
  { method: "GET",  pathPrefix: "/trace/",     handler: handleTraceGet },
  { method: "GET",  pathExact:  "/debug/kv",   handler: handleKvList },
  { method: "POST", pathExact:  "/debug/echo", handler: handleEcho },
  { method: "GET",  pathExact:  "/debug/time", handler: handleTime },
];

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.pathExact && pathname === r.pathExact) return r;
    if (r.pathPrefix && pathname.startsWith(r.pathPrefix)) return r;
  }
  return null;
}

/* ----------------------------- Main fetch entrypoint ----------------------------- */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const isDev = (env.NODE_ENV ?? "production") !== "production";
    const reqId = crypto.randomUUID();
    const idempKey = req.headers.get("Idempotency-Key") || null;

    // startup log (non-secret)
    if (isDev && !env.__checked) {
      log({ at: "startup", hasHmac: !!env.HMAC_SECRET, hasKv: !!env.ATT_KV });
      env.__checked = true;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseHeaders() });
    }

    // quick info
    if (isDev && url.pathname === "/_selfcheck") {
      const useFake = (env.NODE_ENV ?? "production") === "development" && env.STRIPE_FAKE === "1";
      const hasSecret = !!env.STRIPE_SECRET_KEY;
      const stripeMode = useFake ? "fake" : (hasSecret ? "live_or_test" : "none");

      return ok({
        ok: true,
        hasATT_KV: !!env.ATT_KV,
        hasHMAC: !!env.HMAC_SECRET,
        hasRPC_ETH: !!env.RPC_ETH_MAIN,
        hasRPC_BASE: !!env.RPC_BASE_MAIN,
        hasStripe: hasSecret,
        stripeMode,
        queuePrefix: aQueuePrefix(env),
        receiptPrefix: aReceiptPrefix(env),
      });
    }

    // minimal public utility endpoints
    if (url.pathname === "/version") {
      return ok({
        ok: true,
        brand: env.TATTLEHASH_BRAND_NAME ?? "TattleHash",
        model: env.OPENAI_MODEL ?? "gpt-4o-mini",
        anchorMode: env.ANCHOR_MODE ?? "relay",
        env: env.NODE_ENV ?? "production",
        compatDate: "2025-11-01",
      });
    }

    if (url.pathname === "/") {
      return ok({ ok: true, brand: "TattleHash", anchorMode: "relay", model: "gpt-4o-mini" });
    }

    if (url.pathname === "/health") {
      return ok({ ok: true, ts: Date.now(), region: req.cf?.colo ?? "UNK" });
    }

    // --- Dev debug: inspect/cancel gate (available only in NODE_ENV=development)
    if (isDev && url.pathname.startsWith("/debug/gate/")) {
      const [, , , gateId, action] = url.pathname.split("/"); // /debug/gate/:id(/action?)
      const kv = env.GATE_KV ?? env.ATT_KV;

      if (!gateId) return ok({ ok: false, error: "missing_gate_id" });

      const raw = await kv.get(`gate:${gateId}`);
      if (!raw) return ok({ ok: false, error: "gate_not_found" });

      const rec = JSON.parse(raw);

      // GET /debug/gate/:id  → show gate record (no secrets)
      if (!action && req.method === "GET") {
        const safe = { ...rec };
        return ok({ ok: true, gateId, record: safe });
      }

      // POST /debug/gate/:id/cancel → void the Stripe authorization & mark expired
      if (action === "cancel" && req.method === "POST") {
        if (!rec.paymentAuthId) return ok({ ok: false, error: "no_payment_auth_id" });
        await stripeCancel(env, rec.paymentAuthId);
        rec.status = "expired";
        await kv.put(`gate:${gateId}`, JSON.stringify(rec));
        return ok({ ok: true, gateId, status: rec.status });
      }

      return ok({ ok: false, error: "unsupported_debug_action" });
    }

    // route dispatch
    const route = matchRoute(req.method, url.pathname);
    if (route) {
      try {
        const res = await route.handler(req, env, ctx); // may return Response or plain object
        if (res instanceof Response) {
          // ensure our base headers are applied
          const h = new Headers(res.headers);
          for (const [k, v] of Object.entries(baseHeaders())) if (!h.has(k)) h.set(k, v);
          return new Response(res.body, { status: res.status, headers: h });
        }
        return ok(res ?? { ok: true });
      } catch (e) {
        log({ at: "route_error", route: route.pathExact || route.pathPrefix, msg: e?.message || String(e) });
        if (e.message === "body_too_large") return err(413, "body_too_large");
        if (e.message === "invalid_json")  return err(400, "invalid_json");
        return err(500, E.INTERNAL);
      }
    }

    // fallback
    return err(404, E.NOT_FOUND);
  },

  // === Cron entrypoint — process queued anchor jobs ===
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      let cursor = undefined;
      let processed = 0, succeeded = 0, failed = 0;
      do {
        const batch = await listAnchorJobs(env, cursor);
        cursor = batch.cursor;
        for (const k of batch.keys) {
          const id = k.name.split(":").pop();
          if (!id) continue;
          processed++;
          const res = await processOneJob(env, id);
          if (res?.ok) succeeded++; else failed++;
        }
      } while (cursor);
      log({ at: "cron_sweep_done", processed, succeeded, failed });
    })());
  }
};

/* ----------------------- NEW: Async Anchoring route handlers ---------------------- */

async function postAttest(req, env) {
  if (!env?.ATT_KV || !env?.TATTLEHASH_ANCHOR_KV) return err(500, E.MISSING_KV);
  const body = await safeJson(req);
  const initiatorCommit = body?.initiatorCommit;
  const chain = body?.chain ?? "ethereum";
  if (!initiatorCommit) return err(400, "missing_initiatorCommit");

  const rec = makeReceipt(env, initiatorCommit);
  await env.ATT_KV.put(receiptKey(env, rec.id), JSON.stringify(rec));

  await enqueueAnchor(env, {
    id: crypto.randomUUID(),
    receiptId: rec.id,
    createdAt: Date.now(),
    attempts: 0,
    chain
  });

  return { ok: true, receiptId: rec.id, state: rec.mode };
}

async function postConfirm(req, env) {
  if (!env?.ATT_KV) return err(500, E.MISSING_KV);
  const body = await safeJson(req);
  const id = body?.receiptId;
  if (!id) return err(400, "missing_receiptId");
  const key = receiptKey(env, id);
  const raw = await env.ATT_KV.get(key);
  if (!raw) return err(404, E.NOT_FOUND);
  const rec = JSON.parse(raw);
  if (rec.mode !== "pending") return err(400, `invalid_state:${rec.mode}`);
  rec.mode = "confirmed";
  await env.ATT_KV.put(key, JSON.stringify(rec));
  return { ok: true, receiptId: rec.id, state: rec.mode };
}

async function getStatus(req, env) {
  if (!env?.ATT_KV) return err(500, E.MISSING_KV);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return err(400, "missing_id");
  const raw = await env.ATT_KV.get(receiptKey(env, id));
  if (!raw) return err(404, E.NOT_FOUND);
  const rec = JSON.parse(raw);
  return { ok: true, receiptId: rec.id, state: rec.mode, txHash: rec.txHash ?? null };
}

/* --------------------------- Route handler: attestations -------------------------- */

async function postAttestations(req, env) {
  try {
    if (!env?.HMAC_SECRET) return { ok: false, error: E.MISSING_SECRET };
    if (!env?.ATT_KV) return { ok: false, error: E.MISSING_KV };

    // rate limit 60/min/IP
    const ip = req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
    const limited = await rateLimit(env.ATT_KV, `rl:${ip}:attest`, 60, 60);
    if (limited) return err(429, E.RATE_LIMITED);

    const body = await safeJson(req);
    const payload = body?.payload ?? {};
    const meta = body?.meta ?? {};
    const ts = Date.now();
    const ttl = Number(meta?.ttlSeconds);

    const canon = canonicalJson(payload);
    const digest = await sha256Hex(canon);
    const id = `att_${crypto.randomUUID()}`;
    const sig = await hmacHex(env.HMAC_SECRET, digest);

    const att = {
      id,
      digest,
      payload,
      meta,
      ts,
      alg: "HMAC-SHA256",
      keyHint: "hmac:v1",
      expiresAt: Number.isFinite(ttl) && ttl > 0 ? ts + ttl * 1000 : null,
    };

    const putOpts = Number.isFinite(ttl) && ttl > 0 ? { expirationTtl: ttl } : undefined;
    await env.ATT_KV.put(`att:${id}`, JSON.stringify(att), putOpts);

    log({ at: "create", id, ip, ttl: ttl || null });
    return { ok: true, ...att, sig };
  } catch (e) {
    if (e.message === "body_too_large") return err(413, "body_too_large");
    if (e.message === "invalid_json")  return err(400, "invalid_json");
    return err(500, E.INTERNAL);
  }
}

/* ---------------------- Durable Object for global anchor lock --------------------- */

export class AnchorLock {
  constructor(state) { this.state = state; this.locked = false; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/release")) {
      this.locked = false;
      return new Response("ok");
    }
    if (this.locked) return new Response("busy", { status: 423 });
    this.locked = true;
    return new Response("ok");
  }
}
