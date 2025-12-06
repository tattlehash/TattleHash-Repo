/**
 * HTTP Response Helpers
 *
 * All API responses follow a consistent JSON envelope format:
 *
 * Success: { ok: true, data: {...}, timestamp: number }
 * Error:   { ok: false, error: { code: string, message: string, details?: {...} }, timestamp: number }
 *
 * This format is designed for cross-platform consumption (iOS, Android, Web, Desktop).
 */

const API_VERSION = "2.0.0";

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://tattlehash.com',
  'https://www.tattlehash.com',
  'https://verify.tattlehash.com',
  'https://tattlehash-web.pages.dev',
];

// Also allow *.tattlehash-web.pages.dev preview deployments
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow Cloudflare Pages preview deployments
  if (/^https:\/\/[a-f0-9]+\.tattlehash-web\.pages\.dev$/.test(origin)) return true;
  return false;
}

/**
 * Get CORS origin header value based on request origin.
 * Returns the origin if allowed, otherwise returns the primary domain.
 */
export function getCorsOrigin(requestOrigin?: string | null): string {
  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    return requestOrigin;
  }
  // Default to primary domain for non-browser requests
  return 'https://tattlehash.com';
}

export function baseHeaders(extra: Record<string, string> = {}, requestOrigin?: string | null) {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": getCorsOrigin(requestOrigin),
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, idempotency-key, x-test-token",
    "access-control-allow-credentials": "true",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-api-version": API_VERSION,
    ...extra,
  };
}

/**
 * Success response helper
 * Returns: { ok: true, ...data, timestamp: number }
 */
export function ok(data: unknown, init: ResponseInit = {}): Response {
  const body = typeof data === 'object' && data !== null
    ? { ok: true, ...data, timestamp: Date.now() }
    : { ok: true, data, timestamp: Date.now() };

  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status || 200,
    headers: baseHeaders(init.headers as Record<string, string> | undefined),
  });
}

/**
 * Error response helper
 * Returns: { ok: false, error: { code, message, ...details }, timestamp: number }
 *
 * @param status - HTTP status code
 * @param code - Machine-readable error code (e.g., "VALIDATION_ERROR", "NOT_FOUND")
 * @param details - Optional additional error details
 */
export function err(
  status: number,
  code: string,
  details: Record<string, unknown> = {}
): Response {
  const message = details.message || getDefaultMessage(code, status);

  const body = {
    ok: false,
    error: {
      code,
      message,
      ...Object.fromEntries(
        Object.entries(details).filter(([k]) => k !== 'message')
      ),
    },
    timestamp: Date.now(),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(),
  });
}

/**
 * Parse JSON body from request with error handling.
 */
export async function parseBody(
  request: Request
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const text = await request.text();
    if (!text) {
      return { ok: false, error: 'Empty request body' };
    }
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'Invalid JSON' };
  }
}

/**
 * Get default error message based on code or status
 */
function getDefaultMessage(code: string, status: number): string {
  const messages: Record<string, string> = {
    // Client errors
    VALIDATION_ERROR: "Invalid request data",
    NOT_FOUND: "Resource not found",
    UNAUTHORIZED: "Authentication required",
    FORBIDDEN: "Access denied",
    RATE_LIMIT_EXCEEDED: "Too many requests",
    ROUTE_NOT_FOUND: "Endpoint not found",

    // Business logic errors
    CHALLENGE_NOT_FOUND: "Challenge not found",
    CHALLENGE_EXPIRED: "Challenge has expired",
    WALLET_NOT_VERIFIED: "Wallet verification required",
    FUNDS_INSUFFICIENT: "Insufficient funds",
    SIGNATURE_INVALID: "Invalid signature",

    // Server errors
    INTERNAL_ERROR: "Internal server error",
    SERVICE_UNAVAILABLE: "Service temporarily unavailable",
  };

  if (messages[code]) return messages[code];

  // Fallback based on status
  if (status >= 500) return "Server error";
  if (status >= 400) return "Request error";
  return "Unknown error";
}
