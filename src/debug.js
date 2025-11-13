// debug.js — dev-only helpers: trace, kv list, echo, time

import { isDev, json, safeBody, redact } from "./utils/dev.js";

const ALLOWED_PREFIXES = ["gate:", "receipt:", "att:", "idem:", "rcp:", "anchor:queue:", "anchor:"];

export async function handleTraceGet(req, env) {
  if (!isDev(env)) return json({ error: "forbidden" }, 403);
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop();
  const kv = env.GATE_KV ?? env.ATT_KV;

  const [gateRaw, receiptRaw] = await Promise.all([
    kv.get(`gate:${id}`),
    kv.get(`receipt:${id}`),
  ]);

  if (!gateRaw && !receiptRaw) return json({ error: "not_found" }, 404);

  let gate = gateRaw ? JSON.parse(gateRaw) : null;
  let receipt = receiptRaw ? JSON.parse(receiptRaw) : null;

  // minimal redaction on response
  if (gate?.paymentAuthId) gate.paymentAuthId = "pi_…redacted";

  return json({ id, gate, receipt, ts: Date.now() });
}

export async function handleKvList(req, env) {
  if (!isDev(env)) return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const prefix  = url.searchParams.get("prefix") ?? "";
  const limit   = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const include = url.searchParams.get("include"); // "values" to also fetch values (small)

  if (!ALLOWED_PREFIXES.some(p => prefix.startsWith(p))) {
    return json({ error: "prefix_not_allowed", allowed: ALLOWED_PREFIXES }, 400);
  }

  // Route to the appropriate KV by prefix
  let kv = env.ATT_KV;
  if (prefix.startsWith("gate:") || prefix.startsWith("receipt:")) {
    kv = env.GATE_KV ?? env.ATT_KV;
  }
  if (prefix.startsWith("anchor:")) {
    kv = env.TATTLEHASH_ANCHOR_KV ?? env.GATE_KV ?? env.ATT_KV;
  }

  const list = await kv.list({ prefix });
  const keys = list.keys.slice(0, limit).map(k => k.name);

  if (include === "values") {
    const rows = [];
    for (const name of keys) {
      const v = await kv.get(name);
      rows.push({ name, value: tryParse(v) });
    }
    return json({ prefix, count: rows.length, rows });
  }

  return json({ prefix, count: keys.length, keys });
}

export async function handleEcho(req, env) {
  if (!isDev(env)) return json({ error: "forbidden" }, 403);
  const body = await safeBody(req);
  const headers = {};
  req.headers.forEach((v, k) => headers[k] = v);
  return json({ method: req.method, url: req.url, headers, body });
}

export async function handleTime(_req, env) {
  if (!isDev(env)) return json({ error: "forbidden" }, 403);
  return json({ ok: true, ts: Date.now(), iso: new Date().toISOString() });
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}
