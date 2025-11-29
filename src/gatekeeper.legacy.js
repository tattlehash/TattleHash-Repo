// src/gatekeeper.js
// Gate creation + verification (exact-threshold), receipts, idempotency, backfilled GET

import { commitInitiator, commitCounter, commitFinal } from './hashing.js';
import { signLink } from './utils/hmac.js';
import { getNativeBalance, meetsThreshold, prettyEth } from './utils/chains.js';
import { stripeAuthorize, stripeCapture, stripeCancel } from './utils/stripe.js';

const PRICE_CENTS = 199; // $1.99

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

async function safeBody(request) {
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      return await request.json();
    }
  } catch {}
  return {};
}

function toWeiString(x) { return typeof x === 'bigint' ? x.toString() : String(x); }

/** POST /gatekeeper */
export async function handleGatekeeperCreate(request, env) {
  const kv = env.GATE_KV ?? env.ATT_KV;

  // Idempotency (optional): reuse previous response if key is provided
  const idempKey = request.headers.get('Idempotency-Key');
  if (idempKey) {
    const prev = await kv.get(`idem:gatekeeper:${idempKey}`);
    if (prev) return json(JSON.parse(prev));
  }

  const body = await safeBody(request);
  const {
    minAmount = "0",
    token = "ETH",
    mode = "gatekeeper",
    chainIds = [1, 8453],
    initiatorPayload = null,
  } = body ?? {};

  // Initiator commitment
  const initPayload = initiatorPayload ?? {
    ctx: 'tattlehash.gatekeeper.v1',
    type: 'initiator',
    ts: Date.now(),
    payload: { minAmount, token, mode, chainIds },
    _v: 1,
  };
  const I = await commitInitiator(initPayload);

  // Stripe authorize (or fake in dev)
  const gateId = crypto.randomUUID().replace(/-/g, '');
  let intent = { id: `pi_fake_${gateId}` };
  const useFake = env.NODE_ENV === 'development' && env.STRIPE_FAKE === '1';
  if (!useFake) {
    intent = await stripeAuthorize(env, { amountCents: PRICE_CENTS, currency: 'usd', gateId });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
  const expLink = await signLink({ gateId, exp: expiresAt, keyHint: 'v1' }, env.HMAC_SECRET);

  const record = {
    I, minAmount, token, mode, chainIds,
    paymentAuthId: intent.id,
    status: 'pending',
    expiresAt,
  };
  await kv.put(`gate:${gateId}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 2 });

  const response = { id: gateId, expLink, price: 1.99 };
  if (idempKey) await kv.put(`idem:gatekeeper:${idempKey}`, JSON.stringify(response), { expirationTtl: 3600 });
  return json(response);
}

/** POST /gate/:id */
export async function handleGateVerify(request, env) {
  const url = new URL(request.url);
  const gateId = url.pathname.split('/').pop();
  const kv = env.GATE_KV ?? env.ATT_KV;

  const recRaw = await kv.get(`gate:${gateId}`);
  if (!recRaw) return json({ error: 'gate_not_found' }, 404);
  const rec = JSON.parse(recRaw);

  if (rec.status !== 'pending') return json({ error: 'invalid_state', status: rec.status }, 409);
  const nowSec = Math.floor(Date.now() / 1000);
  const useFake = env.NODE_ENV === 'development' && env.STRIPE_FAKE === '1';

  if (nowSec > rec.expiresAt) {
    if (!useFake) await stripeCancel(env, rec.paymentAuthId);
    rec.status = 'expired';
    await kv.put(`gate:${gateId}`, JSON.stringify(rec));
    return json({ error: 'expired' }, 410);
  }

  const body = await safeBody(request);
  const { initiatorCommit, chainId, address, proof } = body ?? {};

  if (initiatorCommit && initiatorCommit !== rec.I) return json({ error: 'initiator_mismatch' }, 400);
  if (!rec.chainIds.includes(chainId)) return json({ error: 'unsupported_chain' }, 400);

  // Balance check
  const balance = await getNativeBalance(env, chainId, address);
  if (!meetsThreshold(balance, String(rec.minAmount))) {
    const receiptFail = {
      ok: false,
      reason: 'insufficient_funds',
      balance: toWeiString(balance),
      balanceEth: prettyEth(balance),
      gateId,
      chainId,
      address,
      I: rec.I,
      ts: Date.now(),
    };
    await kv.put(`receipt:${gateId}`, JSON.stringify(receiptFail), { expirationTtl: 60 * 60 * 24 * 2 });
    return json(receiptFail);
  }

  // Counterparty commitments
  const counterPayload = {
    ctx: 'tattlehash.gatekeeper.v1',
    type: 'counter',
    ts: Date.now(),
    payload: { signer: address, gateId, initiatorCommit: rec.I, mode: rec.mode, expiresAt: rec.expiresAt, chainId },
    _v: 1,
  };
  const C = await commitCounter(counterPayload);
  const FINAL = await commitFinal(rec.I, C);

  if (!useFake) await stripeCapture(env, rec.paymentAuthId);

  rec.status = 'verified';
  rec.C = C;
  rec.FINAL = FINAL;
  rec.chainId = chainId;
  rec.address = address;
  rec.ts = Date.now();
  await kv.put(`gate:${gateId}`, JSON.stringify(rec));

  const receiptOk = {
    ok: true,
    status: 'verified',
    I: rec.I,
    C,
    FINAL,
    gateId,
    chainId,
    address,
    ts: rec.ts,
  };
    await kv.put(`receipt:${gateId}`, JSON.stringify(receiptOk), { expirationTtl: 60 * 60 * 24 * 2 });

// enqueue async anchor job (non-blocking)
    console.log(JSON.stringify({ t: Date.now(), at: "about_to_enqueue", gateId }));
    try {
    const { enqueueAnchor } = await import('./anchor.js');
    await enqueueAnchor(env, gateId);
}   catch (e) {
    console.log(JSON.stringify({ t: Date.now(), at: "anchor_enqueue_error", gateId, msg: e?.message || String(e) }));
}

return json(receiptOk);
}

/** GET /gate/:id (compact receipt; backfills from gate record if needed) */
export async function handleGateGet(request, env) {
  const url = new URL(request.url);
  const gateId = url.pathname.split('/').pop();
  const kv = env.GATE_KV ?? env.ATT_KV;

  // 1) Try compact receipt first
  const raw = await kv.get(`receipt:${gateId}`);
  if (raw) return json(JSON.parse(raw));

  // 2) Backfill from gate record if present
  const recRaw = await kv.get(`gate:${gateId}`);
  if (!recRaw) return json({ error: 'receipt_not_found' }, 404);
  const rec = JSON.parse(recRaw);

  if (rec.status === 'verified' && rec.I && rec.C && rec.FINAL) {
    const receipt = {
      ok: true,
      status: 'verified',
      I: rec.I,
      C: rec.C,
      FINAL: rec.FINAL,
      gateId,
      chainId: rec.chainId ?? undefined,
      address: rec.address ?? undefined,
      ts: rec.ts ?? Date.now(),
    };
    await kv.put(`receipt:${gateId}`, JSON.stringify(receipt), { expirationTtl: 60 * 60 * 24 * 2 });

    // enqueue for async anchoring (non-blocking)
    try {
    const { enqueueAnchor } = await import('./anchor.js');
    await enqueueAnchor(env, gateId);
  } catch (e) {
    console.log(JSON.stringify({ t: Date.now(), at: "anchor_enqueue_error", gateId, msg: e?.message || String(e) }));
  }

    return json(receipt);
  }

  return json({ error: 'receipt_not_found', status: rec.status }, 404);
}
