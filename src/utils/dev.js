// src/utils/dev.js — small helpers for safe local debugging

export function isDev(env) {
  return (env.NODE_ENV ?? "production") === "development";
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type, authorization, idempotency-key",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function safeBody(req) {
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      return await req.json();
    }
  } catch {}
  try {
    const txt = await req.text();
    return { _raw: txt };
  } catch {}
  return {};
}

export function redact(obj) {
  const hide = (v) => {
    if (typeof v !== "string") return v;
    if (v.startsWith("sk_") || v.startsWith("rk_") || v.startsWith("pk_")) return v.slice(0, 6) + "…redacted";
    if (v.length > 80) return v.slice(0, 40) + "…redacted";
    return v;
  };
  const out = {};
  for (const k of Object.keys(obj || {})) out[k] = hide(obj[k]);
  return out;
}
