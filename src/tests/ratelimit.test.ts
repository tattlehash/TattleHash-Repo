import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../middleware/ratelimit';
import { Env } from '../types';

describe('Rate Limiting', () => {
    let env: Env;
    let mockKv: any;

    beforeEach(() => {
        const kvStore = new Map<string, string>();

        mockKv = {
            put: vi.fn((key: string, value: string) => {
                kvStore.set(key, value);
                return Promise.resolve();
            }),
            get: vi.fn((key: string) => {
                return Promise.resolve(kvStore.get(key) || null);
            }),
            delete: vi.fn(),
        };

        env = {
            TATTLEHASH_DB: {} as any,
            GATE_KV: mockKv,
            ATT_KV: mockKv,
            TATTLEHASH_QUEUE: {} as any,
            TATTLEHASH_KV: mockKv,
            TATTLEHASH_CONTENT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
            TATTLEHASH_ERROR_KV: mockKv,
            SHIELD_KV: mockKv,
        };
    });

    it('should allow requests within limit', async () => {
        const request = new Request('https://example.com/test', {
            headers: { 'CF-Connecting-IP': '1.2.3.4' }
        });

        // First request should succeed
        const result1 = await checkRateLimit(request, env, 'public');
        expect(result1.ok).toBe(true);

        // Second request should also succeed
        const result2 = await checkRateLimit(request, env, 'public');
        expect(result2.ok).toBe(true);
    });

    it('should block requests exceeding limit', async () => {
        const request = new Request('https://example.com/test', {
            headers: { 'CF-Connecting-IP': '1.2.3.4' }
        });

        // Make 100 requests (public limit)
        for (let i = 0; i < 100; i++) {
            await checkRateLimit(request, env, 'public');
        }

        // 101st request should be blocked
        const result = await checkRateLimit(request, env, 'public');
        expect(result.ok).toBe(false);

        if (!result.ok) {
            expect(result.response.status).toBe(429);
            expect(result.response.headers.get('Retry-After')).toBeTruthy();
        }
    });

    it('should use different limits for different IPs', async () => {
        const request1 = new Request('https://example.com/test', {
            headers: { 'CF-Connecting-IP': '1.2.3.4' }
        });
        const request2 = new Request('https://example.com/test', {
            headers: { 'CF-Connecting-IP': '5.6.7.8' }
        });

        // Exhaust limit for IP 1
        for (let i = 0; i < 100; i++) {
            await checkRateLimit(request1, env, 'public');
        }

        // IP 1 should be blocked
        const result1 = await checkRateLimit(request1, env, 'public');
        expect(result1.ok).toBe(false);

        // IP 2 should still work
        const result2 = await checkRateLimit(request2, env, 'public');
        expect(result2.ok).toBe(true);
    });

    it('should apply different limits for different endpoint types', async () => {
        const request = new Request('https://example.com/test', {
            headers: { 'CF-Connecting-IP': '1.2.3.4' }
        });

        // Challenge creation has limit of 10/hour
        for (let i = 0; i < 10; i++) {
            const result = await checkRateLimit(request, env, 'challenge_create');
            expect(result.ok).toBe(true);
        }

        // 11th should be blocked
        const result = await checkRateLimit(request, env, 'challenge_create');
        expect(result.ok).toBe(false);
    });
});
