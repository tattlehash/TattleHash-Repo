import { Env } from '../types';
import { err } from '../lib/http';

interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
    keyPrefix: string;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Public endpoints
    'public': { maxRequests: 100, windowSeconds: 60, keyPrefix: 'rl:public' },

    // Challenge endpoints
    'challenge_create': { maxRequests: 10, windowSeconds: 3600, keyPrefix: 'rl:challenge' },
    'challenge_read': { maxRequests: 100, windowSeconds: 60, keyPrefix: 'rl:read' },

    // Webhook endpoints
    'webhook_delivery': { maxRequests: 50, windowSeconds: 60, keyPrefix: 'rl:webhook' },

    // Admin endpoints (higher limits)
    'admin': { maxRequests: 1000, windowSeconds: 3600, keyPrefix: 'rl:admin' },
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
    let requests: number[] = stored ? JSON.parse(stored) : [];

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
    let requests: number[] = stored ? JSON.parse(stored) : [];
    requests = requests.filter(timestamp => timestamp > windowStart);

    const oldestRequest = requests.length > 0 ? Math.min(...requests) : now;
    const resetTime = new Date(oldestRequest + (config.windowSeconds * 1000));

    return {
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - requests.length),
        reset: resetTime
    };
}
