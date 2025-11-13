// src/anchor.js — async anchoring stubs (queue + dev triggers)

function json(obj, status = 200) {
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

function isDev(env) {
  return (env.NODE_ENV ?? "production") === "development";
}

// Top-level helper (exported)
export async function enqueueAnchor(env, gateId) {
  const kv = env.TATTLEHASH_ANCHOR_KV ?? env.GATE_KV ?? env.ATT_KV;
  const item = { gateId, enqueuedAt: Date.now(), status: "queued" };
  await kv.put(`anchor:queue:${gateId}`, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 2 });
  console.log(JSON.stringify({ t: Date.now(), at: "anchor_enqueued", gateId }));
  return true;
}

// POST /anchor/:id — dev trigger to anchor a single verified receipt immediately
export async function handleAnchorTrigger(req, env) {
  const url = new URL(req.url);
  const gateId = url.pathname.split("/").pop();
  const kv = env.GATE_KV ?? env.ATT_KV;

  const rRaw = await kv.get(`receipt:${gateId}`);
  if (!rRaw) return json({ ok: false, error: "receipt_not_found" }, 404);
  const receipt = JSON.parse(rRaw);
  if (!receipt.ok || receipt.status !== "verified") {
    return json({ ok: false, error: "not_verified", status: receipt.status }, 400);
  }

  const anchoredAt = Date.now();
  const anchorTx = null;
  const badgeUrl = `https://api.tattlehash.com/badge/anchor?gateId=${gateId}`;

  const anchored = {
    ok: true,
    status: "anchored",
    I: receipt.I,
    C: receipt.C,
    FINAL: receipt.FINAL,
    gateId,
    chainId: receipt.chainId,
    address: receipt.address,
    anchoredAt,
    anchorTx,
    badgeUrl,
  };

  await kv.put(`receipt:${gateId}`, JSON.stringify(anchored), { expirationTtl: 60 * 60 * 24 * 7 });

  const gRaw = await kv.get(`gate:${gateId}`);
  if (gRaw) {
    const g = JSON.parse(gRaw);
    g.status = "anchored";
    g.anchoredAt = anchoredAt;
    g.anchorTx = anchorTx;
    g.badgeUrl = badgeUrl;
    await kv.put(`gate:${gateId}`, JSON.stringify(g), { expirationTtl: 60 * 60 * 24 * 7 });
  }

  const qkv = env.TATTLEHASH_ANCHOR_KV ?? kv;
  await qkv.delete(`anchor:queue:${gateId}`).catch(() => {});

  return json(anchored);
}

// POST /debug/anchor/process — dev-only: process all queued anchors
export async function handleAnchorProcess(req, env) {
  if (!isDev(env)) return json({ ok: false, error: "forbidden" }, 403);

  const qkv = env.TATTLEHASH_ANCHOR_KV ?? env.GATE_KV ?? env.ATT_KV;
  const list = await qkv.list({ prefix: "anchor:queue:" });

  const processed = [];
  for (const { name } of list.keys) {
    const itemRaw = await qkv.get(name);
    if (!itemRaw) continue;
    const item = JSON.parse(itemRaw);

    const fakeReq = new Request(`http://local/anchor/${item.gateId}`, { method: "POST" });
    const res = await handleAnchorTrigger(fakeReq, env);
    const body = await res.json().catch(() => ({}));

    processed.push({ gateId: item.gateId, result: body.status ?? "error" });
    await qkv.delete(name).catch(() => {});
  }

  return json({ ok: true, count: processed.length, processed });
}
