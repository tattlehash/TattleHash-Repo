import { Env } from '../types';
import { err } from '../lib/http';
import { extractBearerToken, verifyToken } from '../auth';

interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
    keyPrefix: string;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Public endpoints (IP-based)
    'public': { maxRequests: 100, windowSeconds: 60, keyPrefix: 'rl:public' },

    // Challenge endpoints
    'challenge_create': { maxRequests: 10, windowSeconds: 3600, keyPrefix: 'rl:challenge' },
    'challenge_read': { maxRequests: 100, windowSeconds: 60, keyPrefix: 'rl:read' },

    // Webhook endpoints
    'webhook_delivery': { maxRequests: 50, windowSeconds: 60, keyPrefix: 'rl:webhook' },

    // Admin endpoints (higher limits)
    'admin': { maxRequests: 1000, windowSeconds: 3600, keyPrefix: 'rl:admin' },

    // Authenticated user limits (stricter, per-user)
    'auth_sensitive': { maxRequests: 20, windowSeconds: 60, keyPrefix: 'rl:auth:sens' },
    'auth_payment': { maxRequests: 5, windowSeconds: 60, keyPrefix: 'rl:auth:pay' },
    'auth_login': { maxRequests: 5, windowSeconds: 300, keyPrefix: 'rl:auth:login' },

    // Beta limits - daily attestation cap (10 per day per user/IP)
    'attestation_daily': { maxRequests: 10, windowSeconds: 86400, keyPrefix: 'rl:attest:daily' },

    // Verification endpoints - 10/hour per IP
    'verify_ip': { maxRequests: 10, windowSeconds: 3600, keyPrefix: 'rl:verify:ip' },

    // Verification by attestation ID - 50/day per attestation ID
    'verify_attestation': { maxRequests: 50, windowSeconds: 86400, keyPrefix: 'rl:verify:att' },
};

export async function checkRateLimit(
    request: Request,
    env: Env,
    limitType: keyof typeof RATE_LIMITS = 'public'
): Promise<{ ok: true } | { ok: false; response: Response }> {
    const config = RATE_LIMITS[limitType];

    // Get client identifier (IP address)
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `${config.keyPrefix}:${clientIp}`;

    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);

    // Get current request count from KV
    const stored = await env.GATE_KV.get(key);
    let requests: number[] = [];
    if (stored) {
        try {
            requests = JSON.parse(stored);
        } catch (e) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'rate_limit_parse_error_public',
                key,
                stored_value: stored.substring(0, 100),
                error: String(e),
            }));
            await env.GATE_KV.delete(key);
        }
    }

    // Remove requests outside the window
    requests = requests.filter(timestamp => timestamp > windowStart);

    // Check if limit exceeded
    if (requests.length >= config.maxRequests) {
        const oldestRequest = Math.min(...requests);
        const retryAfter = Math.ceil((oldestRequest + (config.windowSeconds * 1000) - now) / 1000);

        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
                    retry_after: retryAfter
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': retryAfter.toString(),
                        'X-RateLimit-Limit': config.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': new Date(oldestRequest + (config.windowSeconds * 1000)).toISOString()
                    }
                }
            )
        };
    }

    // Add current request
    requests.push(now);

    // Store updated request list with expiration
    await env.GATE_KV.put(
        key,
        JSON.stringify(requests),
        { expirationTtl: config.windowSeconds }
    );

    return { ok: true };
}

export async function getRateLimitStatus(
    request: Request,
    env: Env,
    limitType: keyof typeof RATE_LIMITS = 'public'
): Promise<{
    limit: number;
    remaining: number;
    reset: Date;
}> {
    const config = RATE_LIMITS[limitType];
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `${config.keyPrefix}:${clientIp}`;

    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);

    const stored = await env.GATE_KV.get(key);
    let requests: number[] = [];
    if (stored) {
        try {
            requests = JSON.parse(stored);
        } catch {
            // Ignore corrupt data in status check
        }
    }
    requests = requests.filter(timestamp => timestamp > windowStart);

    const oldestRequest = requests.length > 0 ? Math.min(...requests) : now;
    const resetTime = new Date(oldestRequest + (config.windowSeconds * 1000));

    return {
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - requests.length),
        reset: resetTime
    };
}

/**
 * Check rate limit for authenticated users.
 * Uses user ID instead of IP address for more precise limiting.
 * This prevents a single user from abusing the system regardless of IP.
 */
export async function checkUserRateLimit(
    request: Request,
    env: Env,
    limitType: keyof typeof RATE_LIMITS = 'auth_sensitive'
): Promise<{ ok: true; userId?: string } | { ok: false; response: Response }> {
    const config = RATE_LIMITS[limitType];

    // Try to extract user ID from token
    const token = extractBearerToken(request);
    let identifier: string;
    let userId: string | undefined;

    if (token) {
        const payload = await verifyToken(env, token);
        if (payload?.sub) {
            identifier = `user:${payload.sub}`;
            userId = payload.sub;
        } else {
            // Invalid token - fall back to IP but with stricter limits
            const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
            identifier = `ip:${clientIp}`;
        }
    } else {
        // No token - use IP
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        identifier = `ip:${clientIp}`;
    }

    const key = `${config.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);

    // Get current request count from KV
    const stored = await env.GATE_KV.get(key);
    let requests: number[] = [];
    if (stored) {
        try {
            requests = JSON.parse(stored);
        } catch (e) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'rate_limit_parse_error_user',
                key,
                stored_value: stored.substring(0, 100),
                error: String(e),
            }));
            await env.GATE_KV.delete(key);
        }
    }

    // Remove requests outside the window
    requests = requests.filter(timestamp => timestamp > windowStart);

    // Check if limit exceeded
    if (requests.length >= config.maxRequests) {
        const oldestRequest = Math.min(...requests);
        const retryAfter = Math.ceil((oldestRequest + (config.windowSeconds * 1000) - now) / 1000);

        // Log rate limit hit for security monitoring
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'user_rate_limit_exceeded',
            identifier,
            limit_type: limitType,
            requests_count: requests.length,
            max_requests: config.maxRequests,
        }));

        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: `Too many requests. Try again in ${retryAfter} seconds.`,
                    retry_after: retryAfter
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': retryAfter.toString(),
                        'X-RateLimit-Limit': config.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': new Date(oldestRequest + (config.windowSeconds * 1000)).toISOString()
                    }
                }
            )
        };
    }

    // Add current request
    requests.push(now);

    // Store updated request list with expiration
    await env.GATE_KV.put(
        key,
        JSON.stringify(requests),
        { expirationTtl: config.windowSeconds }
    );

    return { ok: true, userId };
}

/**
 * Check login rate limit.
 * Uses IP + email to prevent brute force attacks on specific accounts.
 */
export async function checkLoginRateLimit(
    request: Request,
    env: Env,
    email: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
    const config = RATE_LIMITS['auth_login'];
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Rate limit by IP + email to prevent:
    // 1. Distributed brute force on single account (by email)
    // 2. Single IP trying many accounts (by IP)
    const emailKey = `${config.keyPrefix}:email:${email.toLowerCase()}`;
    const ipKey = `${config.keyPrefix}:ip:${clientIp}`;

    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);

    // Check email-based limit
    const emailStored = await env.GATE_KV.get(emailKey);
    let emailRequests: number[] = [];
    if (emailStored) {
        try {
            emailRequests = JSON.parse(emailStored);
        } catch (e) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'rate_limit_parse_error',
                key: emailKey,
                stored_value: emailStored.substring(0, 100),
                error: String(e),
            }));
            // Clear corrupt data
            await env.GATE_KV.delete(emailKey);
        }
    }
    emailRequests = emailRequests.filter(ts => ts > windowStart);

    // Check IP-based limit (higher threshold for IP)
    const ipStored = await env.GATE_KV.get(ipKey);
    let ipRequests: number[] = [];
    if (ipStored) {
        try {
            ipRequests = JSON.parse(ipStored);
        } catch (e) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'rate_limit_parse_error',
                key: ipKey,
                stored_value: ipStored.substring(0, 100),
                error: String(e),
            }));
            // Clear corrupt data
            await env.GATE_KV.delete(ipKey);
        }
    }
    ipRequests = ipRequests.filter(ts => ts > windowStart);

    const ipLimit = config.maxRequests * 3; // 15 attempts per IP

    if (emailRequests.length >= config.maxRequests || ipRequests.length >= ipLimit) {
        const emailOldest = emailRequests.length > 0 ? Math.min(...emailRequests) : now;
        const ipOldest = ipRequests.length > 0 ? Math.min(...ipRequests) : now;
        const oldestRequest = Math.min(emailOldest, ipOldest);
        const retryAfter = Math.ceil((oldestRequest + (config.windowSeconds * 1000) - now) / 1000);

        // Log suspicious activity
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'login_rate_limit_exceeded',
            email: email.substring(0, 3) + '***', // Partial email for privacy
            ip: clientIp,
            email_attempts: emailRequests.length,
            ip_attempts: ipRequests.length,
        }));

        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'TOO_MANY_LOGIN_ATTEMPTS',
                    message: `Too many login attempts. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`,
                    retry_after: retryAfter
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': retryAfter.toString(),
                    }
                }
            )
        };
    }

    // Record this attempt
    emailRequests.push(now);
    ipRequests.push(now);

    await Promise.all([
        env.GATE_KV.put(emailKey, JSON.stringify(emailRequests), { expirationTtl: config.windowSeconds }),
        env.GATE_KV.put(ipKey, JSON.stringify(ipRequests), { expirationTtl: config.windowSeconds }),
    ]);

    return { ok: true };
}

/**
 * Check rate limit for verification endpoints.
 * Combines IP-based (10/hour) and attestation-ID-based (50/day) limits.
 */
export async function checkVerificationRateLimit(
    request: Request,
    env: Env,
    attestationId?: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();

    // Check IP-based limit (10/hour)
    const ipConfig = RATE_LIMITS['verify_ip'];
    const ipKey = `${ipConfig.keyPrefix}:${clientIp}`;
    const ipWindowStart = now - (ipConfig.windowSeconds * 1000);

    const ipStored = await env.GATE_KV.get(ipKey);
    let ipRequests: number[] = [];
    if (ipStored) {
        try {
            ipRequests = JSON.parse(ipStored);
        } catch (e) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'rate_limit_parse_error_verify_ip',
                key: ipKey,
                error: String(e),
            }));
            await env.GATE_KV.delete(ipKey);
        }
    }
    ipRequests = ipRequests.filter(ts => ts > ipWindowStart);

    if (ipRequests.length >= ipConfig.maxRequests) {
        const oldestRequest = Math.min(...ipRequests);
        const retryAfter = Math.ceil((oldestRequest + (ipConfig.windowSeconds * 1000) - now) / 1000);
        const retryMinutes = Math.ceil(retryAfter / 60);

        console.error(JSON.stringify({
            t: Date.now(),
            at: 'verify_ip_rate_limit_exceeded',
            ip: clientIp,
            requests_count: ipRequests.length,
        }));

        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: `You've reached the verification limit (10 per hour). Please try again in ${retryMinutes} minute${retryMinutes > 1 ? 's' : ''}.`,
                    retry_after: retryAfter,
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': retryAfter.toString(),
                        'X-RateLimit-Limit': ipConfig.maxRequests.toString(),
                        'X-RateLimit-Remaining': '0',
                    },
                }
            ),
        };
    }

    // Check attestation-ID-based limit (50/day) if provided
    if (attestationId) {
        const attConfig = RATE_LIMITS['verify_attestation'];
        const attKey = `${attConfig.keyPrefix}:${attestationId}`;
        const attWindowStart = now - (attConfig.windowSeconds * 1000);

        const attStored = await env.GATE_KV.get(attKey);
        let attRequests: number[] = [];
        if (attStored) {
            try {
                attRequests = JSON.parse(attStored);
            } catch (e) {
                console.error(JSON.stringify({
                    t: Date.now(),
                    at: 'rate_limit_parse_error_verify_att',
                    key: attKey,
                    error: String(e),
                }));
                await env.GATE_KV.delete(attKey);
            }
        }
        attRequests = attRequests.filter(ts => ts > attWindowStart);

        if (attRequests.length >= attConfig.maxRequests) {
            const oldestRequest = Math.min(...attRequests);
            const retryAfter = Math.ceil((oldestRequest + (attConfig.windowSeconds * 1000) - now) / 1000);
            const retryHours = Math.ceil(retryAfter / 3600);

            console.error(JSON.stringify({
                t: Date.now(),
                at: 'verify_attestation_rate_limit_exceeded',
                attestation_id: attestationId,
                requests_count: attRequests.length,
            }));

            return {
                ok: false,
                response: new Response(
                    JSON.stringify({
                        error: 'RATE_LIMIT_EXCEEDED',
                        message: `This attestation has reached its daily verification limit (50 per day). Please try again in ${retryHours} hour${retryHours > 1 ? 's' : ''}.`,
                        retry_after: retryAfter,
                    }),
                    {
                        status: 429,
                        headers: {
                            'Content-Type': 'application/json',
                            'Retry-After': retryAfter.toString(),
                            'X-RateLimit-Limit': attConfig.maxRequests.toString(),
                            'X-RateLimit-Remaining': '0',
                        },
                    }
                ),
            };
        }

        // Record this verification against attestation ID
        attRequests.push(now);
        await env.GATE_KV.put(attKey, JSON.stringify(attRequests), { expirationTtl: attConfig.windowSeconds });
    }

    // Record this verification against IP
    ipRequests.push(now);
    await env.GATE_KV.put(ipKey, JSON.stringify(ipRequests), { expirationTtl: ipConfig.windowSeconds });

    return { ok: true };
}
