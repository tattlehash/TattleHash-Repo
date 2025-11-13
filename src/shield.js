// shield.js — Shield v1 endpoint (profiles, hard rules, logged outcomes)

const PROFILES = { precise: 0.3, balanced: 0.6, insightful: 0.9 };
function clamp(t) { return Math.max(0.2, Math.min(0.9, t)); }

const HARD_RULES = [
  /walletconnect.*auto/i,
  /\.xn--/i,                           // homograph TLDs
  /(drainer|sweep|approveall)\./i
];

function runHardRules(urls) {
  const reasons = [];
  const text = urls.join(' ');
  for (const r of HARD_RULES) if (r.test(text)) reasons.push(String(r));
  return { block: reasons.length > 0, reasons };
}

export async function handleShieldScan(request, env) {
  const { urls = [], profile = 'balanced' } = await request.json();
  const temp = clamp(PROFILES[profile] ?? 0.4);
  const rules = runHardRules(urls);
  let outcome = 'pass';
  let reasons = [];

  if (rules.block) {
    outcome = 'block';
    reasons = rules.reasons;
  } else {
    // placeholder LLM/RAG influence → can only add 'warn'
    if (urls.some(u => /^http:\/\//i.test(u))) { outcome = 'warn'; reasons.push('insecure-http'); }
  }

  const rec = {
    profile, temp, policyVersion: 'shield-v1',
    outcome, reasons, urlCount: urls.length, ts: Date.now()
  };
  if (env.SHIELD_KV) {
    const id = crypto.randomUUID();
    await env.SHIELD_KV.put(`shield:v1:${id}`, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 7 });
  }

  return json({ outcome, reasons, policyVersion: 'shield-v1' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
