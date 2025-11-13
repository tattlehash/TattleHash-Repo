// utils/hmac.js — HMAC signing + expiring links

async function hmacSHA256(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signLink({ gateId, exp, keyHint = 'v1' }, secret) {
  const payload = `${gateId}.${exp}.${keyHint}`;
  const sig = await hmacSHA256(new TextEncoder().encode(secret), new TextEncoder().encode(payload));
  return { keyHint, sig, exp };
}

export async function verifyLink({ gateId, exp, keyHint, sig }, secret) {
  if (Date.now() / 1000 > Number(exp)) return false;
  const expect = await signLink({ gateId, exp, keyHint }, secret);
  return safeEq(expect.sig, sig);
}

function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
