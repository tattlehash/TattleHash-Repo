// utils/stripe.js — Stripe via REST (manual-capture PaymentIntents) with dev stub

const STRIPE_API = 'https://api.stripe.com/v1';

function authHeader(secret) {
  if (!secret) throw new Error('Missing STRIPE_SECRET_KEY');
  return { Authorization: `Bearer ${secret}` };
}

function fakeId(prefix = 'pi') {
  return `${prefix}_fake_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Create a PaymentIntent (manual capture)
 * In dev (STRIPE_FAKE=1) it just returns a fake record.
 */
export async function stripeAuthorize(env, { amountCents, currency = 'usd', gateId }) {
  // --- Fake mode for local dev
  if (env.NODE_ENV === 'development' && env.STRIPE_FAKE === '1') {
    return {
      id: fakeId('pi'),
      amount: amountCents,
      currency,
      metadata: { gateId },
      capture_method: 'manual',
      status: 'requires_capture',
    };
  }

  // --- Real Stripe call
  const body = new URLSearchParams({
    amount: String(amountCents),
    currency,
    capture_method: 'manual',
    'metadata[gateId]': gateId,
  });
  const res = await fetch(`${STRIPE_API}/payment_intents`, {
    method: 'POST',
    headers: { ...authHeader(env.STRIPE_SECRET_KEY) },
    body,
  });
  if (!res.ok) throw new Error(`Stripe authorize failed: ${res.status}`);
  return res.json();
}

/**
 * Capture a PaymentIntent
 */
export async function stripeCapture(env, intentId) {
  if (env.NODE_ENV === 'development' && env.STRIPE_FAKE === '1') {
    return { id: intentId, status: 'succeeded', captured: true };
  }
  const res = await fetch(`${STRIPE_API}/payment_intents/${intentId}/capture`, {
    method: 'POST',
    headers: { ...authHeader(env.STRIPE_SECRET_KEY) },
  });
  if (!res.ok) throw new Error(`Stripe capture failed: ${res.status}`);
  return res.json();
}

/**
 * Cancel a PaymentIntent
 */
export async function stripeCancel(env, intentId) {
  if (env.NODE_ENV === 'development' && env.STRIPE_FAKE === '1') {
    return { id: intentId, status: 'canceled', cancellation_reason: 'abandoned' };
  }
  const body = new URLSearchParams({ cancellation_reason: 'abandoned' });
  const res = await fetch(`${STRIPE_API}/payment_intents/${intentId}/cancel`, {
    method: 'POST',
    headers: { ...authHeader(env.STRIPE_SECRET_KEY) },
    body,
  });
  if (!res.ok) throw new Error(`Stripe cancel failed: ${res.status}`);
  return res.json();
}
