/**
 * CSRF Protection Middleware
 *
 * Validates Origin/Referer headers for state-changing requests.
 * Works alongside Bearer token authentication for defense-in-depth.
 */

import { err } from '../lib/http';
import type { Env } from '../types';

// Allowed origins for CSRF validation
const ALLOWED_ORIGINS = [
    'https://tattlehash.com',
    'https://www.tattlehash.com',
    'https://verify.tattlehash.com',
    'https://app.tattlehash.com',
    'https://tattlehash-worker.ashiscock.workers.dev',
    'https://tattlehash-web.pages.dev',
];

// Check if origin is a Cloudflare Pages preview deployment
function isPagesPreviewOrigin(origin: string): boolean {
    return /^https:\/\/[a-f0-9]+\.tattlehash-web\.pages\.dev$/.test(origin);
}

// Development origins (only allowed in non-production)
const DEV_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
];

// Check if origin is a localhost development origin (any port)
function isLocalhostOrigin(origin: string): boolean {
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' &&
               (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
        return false;
    }
}

// Routes exempt from CSRF (webhooks with their own verification)
const CSRF_EXEMPT_PATHS = [
    '/webhooks/stripe',  // Has Stripe signature verification
    '/health',           // Read-only health check
];

/**
 * Check if a request requires CSRF validation.
 */
function requiresCsrfValidation(method: string, pathname: string): boolean {
    // Only state-changing methods need CSRF protection
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        return false;
    }

    // Check exempt paths
    for (const exempt of CSRF_EXEMPT_PATHS) {
        if (pathname === exempt || pathname.startsWith(exempt + '/')) {
            return false;
        }
    }

    return true;
}

/**
 * Validate Origin header against allowed origins.
 */
function isValidOrigin(origin: string | null, env: Env): boolean {
    // No origin header = same-origin request or non-browser client
    // This is safe because:
    // 1. Same-origin requests are trusted
    // 2. Non-browser clients (curl, etc.) can't make cross-origin attacks
    // 3. Authorization header provides additional protection
    if (!origin) {
        return true;
    }

    // Check production origins
    if (ALLOWED_ORIGINS.includes(origin)) {
        return true;
    }

    // Allow Cloudflare Pages preview deployments
    if (isPagesPreviewOrigin(origin)) {
        return true;
    }

    // Allow dev origins only if not in production
    // Check for development indicator in environment
    const isProduction = env.NODE_ENV === 'production';
    if (!isProduction && DEV_ORIGINS.includes(origin)) {
        return true;
    }

    // Allow any localhost origin for development testing
    // This is safe because localhost requests can only come from the local machine
    if (isLocalhostOrigin(origin)) {
        return true;
    }

    return false;
}

/**
 * Extract origin from Referer header as fallback.
 */
function extractOriginFromReferer(referer: string | null): string | null {
    if (!referer) return null;
    try {
        const url = new URL(referer);
        return url.origin;
    } catch {
        return null;
    }
}

/**
 * Validate CSRF for a request.
 * Returns null if valid, Response if rejected.
 */
export async function validateCsrf(
    request: Request,
    env: Env
): Promise<Response | null> {
    const { pathname } = new URL(request.url);

    // Skip validation for safe methods and exempt paths
    if (!requiresCsrfValidation(request.method, pathname)) {
        return null;
    }

    // Get Origin header, fall back to Referer
    let origin = request.headers.get('Origin');
    if (!origin) {
        origin = extractOriginFromReferer(request.headers.get('Referer'));
    }

    // Validate origin
    if (!isValidOrigin(origin, env)) {
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'csrf_rejected',
            origin: origin || 'null',
            pathname,
            method: request.method,
        }));

        return new Response(
            JSON.stringify({
                ok: false,
                error: 'CSRF_VALIDATION_FAILED',
                details: { message: 'Invalid request origin' },
            }),
            {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    return null;
}

/**
 * Add CSRF token to response (for cookie-based flows if needed later).
 * Currently unused but available for future expansion.
 */
export function generateCsrfToken(): string {
    const buffer = new Uint8Array(32);
    crypto.getRandomValues(buffer);
    return Array.from(buffer)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
