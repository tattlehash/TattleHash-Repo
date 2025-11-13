// response helpers + secure defaults
export function baseHeaders(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, idempotency-key",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-version": "tattlehash-worker/2025-11-06",
    ...extra,
  };
}
export const ok  = (obj: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(obj), { ...init, headers: baseHeaders(init.headers as any) });

export const err = (status: number, code: string, extras: Record<string, unknown> = {}) =>
  ok({ ok: false, error: code, ...extras }, { status });
