// hashing.js — Canonical + labeled hashing + helpers (Workers runtime)

export const HASH_ALGO = 'SHA-256';

// Sorted-key preimage: { ctx, type, ts, payload, _v }
export function canonicalPreimage({ ctx, type, ts, payload, _v }) {
  const obj = { ctx, type, ts, payload, _v };
  return JSON.stringify(sortKeysDeep(obj));
}

export async function sha256(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(buf));
}

// Labeled hashing: H("tattlehash/<label>/v1" || bytes)
export async function labeledHash(label, bytes) {
  const prefix = new TextEncoder().encode(`tattlehash/${label}/v1`);
  const joined = concat(prefix, bytes);
  return sha256(joined);
}

// === Commit helpers (verbatim from plan) ===
// I = H("attest/v1" || canonical(initiatorPayload))
// C = H("counter/v1" || canonical({ signer, gateId, initiatorCommit:I, mode, expiresAt, chainId }))
// FINAL = H("final/v1" || I || C)
export async function commitInitiator(initiatorPayload) {
  const canon = canonicalPreimage(initiatorPayload);
  return labeledHash('attest', new TextEncoder().encode(canon));
}
export async function commitCounter(counterPayload) {
  const canon = canonicalPreimage(counterPayload);
  return labeledHash('counter', new TextEncoder().encode(canon));
}
export async function commitFinal(I_hex, C_hex) {
  const iBytes = hexToBytes(I_hex);
  const cBytes = hexToBytes(C_hex);
  const joined = concat(iBytes, cBytes);
  return labeledHash('final', joined);
}

// === Utilities ===
export function clampClientTs(tsMs, skewMs = 5 * 60 * 1000) {
  const now = Date.now();
  return Math.min(Math.max(tsMs, now - skewMs), now + skewMs);
}

function sortKeysDeep(x) {
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (x && typeof x === 'object') {
    return Object.keys(x).sort().reduce((acc, k) => {
      acc[k] = sortKeysDeep(x[k]);
      return acc;
    }, {});
  }
  return x;
}

export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i*2, i*2+2), 16);
  return out;
}
export function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
