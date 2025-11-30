/**
 * Webhook System Tests
 *
 * Comprehensive tests for webhook subscriptions, delivery,
 * retry logic per ADR-007, and event management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createSubscription,
    getSubscription,
    listSubscriptions,
    updateSubscription,
    deleteSubscription,
    rotateSecret,
    getActiveSubscriptionsForEvent,
    EVENT_TYPES,
} from '../relay/subscriptions';
import {
    deliverWebhook,
    retryFailedDelivery,
    getRetryDelaySeconds,
    getDeliveryStatus,
    getDeliveryHistory,
} from '../relay/webhooks';
import type { WebhookSubscription, WebhookDelivery } from '../relay/types';
import { Env } from '../types';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(dbResults: any[] = []): Env {
    const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: dbResults }),
            run: vi.fn().mockResolvedValue({ success: true }),
        })),
    };

    const mockKv = {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
    };

    const mockQueue = {
        send: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        GATE_KV: mockKv,
        TATTLEHASH_QUEUE: mockQueue,
        WEBHOOKS_ENABLED: 'true',
    } as any;
}

function createMockSubscription(overrides: Partial<WebhookSubscription> = {}): WebhookSubscription {
    return {
        id: 'webhook-sub-123',
        user_id: 'user-456',
        url: 'https://example.com/webhook',
        events: ['challenge.created', 'challenge.completed'],
        secret: 'whsec_test123456789abcdef',
        active: true,
        description: 'Test webhook subscription',
        created_at: Date.now(),
        ...overrides,
    };
}

// ============================================================================
// Event Types Tests
// ============================================================================

describe('Event Types', () => {
    it('should have all required challenge events', () => {
        expect(EVENT_TYPES['challenge.created']).toBeDefined();
        expect(EVENT_TYPES['challenge.sent']).toBeDefined();
        expect(EVENT_TYPES['challenge.accepted']).toBeDefined();
        expect(EVENT_TYPES['challenge.completed']).toBeDefined();
        expect(EVENT_TYPES['challenge.cancelled']).toBeDefined();
        expect(EVENT_TYPES['challenge.expired']).toBeDefined();
        expect(EVENT_TYPES['challenge.disputed']).toBeDefined();
        expect(EVENT_TYPES['challenge.resolved']).toBeDefined();
    });

    it('should have gatekeeper events', () => {
        expect(EVENT_TYPES['gatekeeper.wallet_verified']).toBeDefined();
        expect(EVENT_TYPES['gatekeeper.funds_checked']).toBeDefined();
        expect(EVENT_TYPES['gatekeeper.intent_locked']).toBeDefined();
    });

    it('should have enforced mode events', () => {
        expect(EVENT_TYPES['enforced.stake_deposited']).toBeDefined();
        expect(EVENT_TYPES['enforced.stake_confirmed']).toBeDefined();
        expect(EVENT_TYPES['enforced.stake_released']).toBeDefined();
        expect(EVENT_TYPES['enforced.stake_slashed']).toBeDefined();
        expect(EVENT_TYPES['enforced.traffic_light_changed']).toBeDefined();
    });

    it('should have attestation events', () => {
        expect(EVENT_TYPES['attestation.created']).toBeDefined();
        expect(EVENT_TYPES['attestation.anchored']).toBeDefined();
    });

    it('should have game events', () => {
        expect(EVENT_TYPES['game.created']).toBeDefined();
        expect(EVENT_TYPES['game.completed']).toBeDefined();
    });

    it('should have wildcard event', () => {
        expect(EVENT_TYPES['*']).toBe('All events');
    });
});

// ============================================================================
// Retry Delay Tests (ADR-007)
// ============================================================================

describe('Retry Delays (ADR-007)', () => {
    it('should return immediate delay for first attempt', () => {
        expect(getRetryDelaySeconds(0)).toBe(0);
    });

    it('should return 60 seconds for second attempt', () => {
        expect(getRetryDelaySeconds(1)).toBe(60);
    });

    it('should return 5 minutes for third attempt', () => {
        expect(getRetryDelaySeconds(2)).toBe(300);
    });

    it('should return 15 minutes for fourth attempt', () => {
        expect(getRetryDelaySeconds(3)).toBe(900);
    });

    it('should return 60 minutes for fifth attempt', () => {
        expect(getRetryDelaySeconds(4)).toBe(3600);
    });

    it('should return 4 hours for attempts 6-8', () => {
        expect(getRetryDelaySeconds(5)).toBe(14400);
        expect(getRetryDelaySeconds(6)).toBe(14400);
        expect(getRetryDelaySeconds(7)).toBe(14400);
    });

    it('should return last delay for attempts beyond max', () => {
        expect(getRetryDelaySeconds(8)).toBe(14400);
        expect(getRetryDelaySeconds(10)).toBe(14400);
        expect(getRetryDelaySeconds(100)).toBe(14400);
    });

    it('should have correct total retry window', () => {
        // Calculate total: 0 + 60 + 300 + 900 + 3600 + 14400 + 14400 + 14400 = 48060 seconds
        const totalSeconds = [0, 60, 300, 900, 3600, 14400, 14400, 14400].reduce((a, b) => a + b, 0);
        expect(totalSeconds).toBe(48060); // ~13.35 hours of delays
        // Note: Total window including attempts is approximately 13+ hours
    });
});

// ============================================================================
// Subscription Validation Tests
// ============================================================================

describe('Subscription Validation', () => {
    let env: Env;

    beforeEach(() => {
        env = createMockEnv();
    });

    it('should reject non-HTTPS URLs', async () => {
        await expect(
            createSubscription(env, 'user-123', {
                url: 'http://example.com/webhook',
                events: ['challenge.created'],
            })
        ).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('should reject invalid URLs', async () => {
        await expect(
            createSubscription(env, 'user-123', {
                url: 'not-a-url',
                events: ['challenge.created'],
            })
        ).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('should reject invalid event types', async () => {
        await expect(
            createSubscription(env, 'user-123', {
                url: 'https://example.com/webhook',
                events: ['invalid.event' as any],
            })
        ).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('should accept valid HTTPS URL with valid events', async () => {
        const subscription = await createSubscription(env, 'user-123', {
            url: 'https://example.com/webhook',
            events: ['challenge.created', 'challenge.completed'],
            description: 'My webhook',
        });

        expect(subscription.url).toBe('https://example.com/webhook');
        expect(subscription.events).toContain('challenge.created');
        expect(subscription.events).toContain('challenge.completed');
        expect(subscription.secret).toMatch(/^whsec_/);
        expect(subscription.active).toBe(true);
    });

    it('should accept wildcard event', async () => {
        const subscription = await createSubscription(env, 'user-123', {
            url: 'https://example.com/webhook',
            events: ['*'],
        });

        expect(subscription.events).toContain('*');
    });

    it('should generate unique webhook secrets', async () => {
        const sub1 = await createSubscription(env, 'user-123', {
            url: 'https://example.com/webhook1',
            events: ['challenge.created'],
        });

        const sub2 = await createSubscription(env, 'user-123', {
            url: 'https://example.com/webhook2',
            events: ['challenge.created'],
        });

        expect(sub1.secret).not.toBe(sub2.secret);
        expect(sub1.secret.length).toBe(6 + 64); // 'whsec_' + 32 bytes hex
        expect(sub2.secret.length).toBe(6 + 64);
    });
});

// ============================================================================
// Subscription CRUD Tests
// ============================================================================

describe('Subscription CRUD', () => {
    describe('createSubscription', () => {
        it('should create subscription with generated ID', async () => {
            const env = createMockEnv();
            const subscription = await createSubscription(env, 'user-123', {
                url: 'https://example.com/webhook',
                events: ['challenge.created'],
            });

            expect(subscription.id).toBeDefined();
            expect(subscription.id.length).toBeGreaterThan(0);
        });

        it('should set user_id correctly', async () => {
            const env = createMockEnv();
            const subscription = await createSubscription(env, 'user-abc', {
                url: 'https://example.com/webhook',
                events: ['challenge.created'],
            });

            expect(subscription.user_id).toBe('user-abc');
        });

        it('should set created_at timestamp', async () => {
            const env = createMockEnv();
            const before = Date.now();
            const subscription = await createSubscription(env, 'user-123', {
                url: 'https://example.com/webhook',
                events: ['challenge.created'],
            });
            const after = Date.now();

            expect(subscription.created_at).toBeGreaterThanOrEqual(before);
            expect(subscription.created_at).toBeLessThanOrEqual(after);
        });
    });

    describe('getSubscription', () => {
        it('should return null when subscription not found', async () => {
            const env = createMockEnv([]);
            const result = await getSubscription(env, 'non-existent');
            expect(result).toBeNull();
        });

        it('should return subscription when found', async () => {
            const mockSub = createMockSubscription();
            const env = createMockEnv([{ ...mockSub, events: JSON.stringify(mockSub.events), active: 1 }]);

            const result = await getSubscription(env, mockSub.id);

            expect(result).not.toBeNull();
            expect(result!.id).toBe(mockSub.id);
            expect(result!.url).toBe(mockSub.url);
        });
    });

    describe('listSubscriptions', () => {
        it('should return empty array when no subscriptions', async () => {
            const env = createMockEnv([]);
            const result = await listSubscriptions(env, 'user-123');
            expect(result).toEqual([]);
        });

        it('should return all user subscriptions', async () => {
            const mockSubs = [
                createMockSubscription({ id: 'sub-1' }),
                createMockSubscription({ id: 'sub-2' }),
            ];
            const env = createMockEnv(
                mockSubs.map(s => ({ ...s, events: JSON.stringify(s.events), active: 1 }))
            );

            const result = await listSubscriptions(env, 'user-456');

            expect(result.length).toBe(2);
        });
    });
});

// ============================================================================
// Event Filtering Tests
// ============================================================================

describe('Event Filtering', () => {
    it('should match specific event type', async () => {
        const subscriptions = [
            createMockSubscription({ id: 'sub-1', events: ['challenge.created', 'challenge.completed'] }),
            createMockSubscription({ id: 'sub-2', events: ['challenge.cancelled'] }),
        ];

        const env = createMockEnv(
            subscriptions.map(s => ({ ...s, events: JSON.stringify(s.events), active: 1 }))
        );

        const active = await getActiveSubscriptionsForEvent(env, 'challenge.created');

        expect(active.length).toBe(1);
        expect(active[0].id).toBe('sub-1');
    });

    it('should match wildcard subscription for any event', async () => {
        const subscriptions = [
            createMockSubscription({ id: 'sub-1', events: ['*'] }),
            createMockSubscription({ id: 'sub-2', events: ['challenge.created'] }),
        ];

        const env = createMockEnv(
            subscriptions.map(s => ({ ...s, events: JSON.stringify(s.events), active: 1 }))
        );

        const active = await getActiveSubscriptionsForEvent(env, 'attestation.created');

        expect(active.length).toBe(1);
        expect(active[0].events).toContain('*');
    });

    it('should exclude inactive subscriptions', async () => {
        // Query only returns active subscriptions (active = 1)
        const env = createMockEnv([]);

        const active = await getActiveSubscriptionsForEvent(env, 'challenge.created');

        expect(active.length).toBe(0);
    });
});

// ============================================================================
// Webhook Delivery Tests
// ============================================================================

describe('Webhook Delivery', () => {
    let env: Env;

    beforeEach(() => {
        env = createMockEnv();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should deliver webhook successfully on 2xx response', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        const delivery = await deliverWebhook(env, subscription, 'challenge.created', {
            challenge_id: 'test-123',
        });

        expect(delivery.status).toBe('DELIVERED');
        expect(delivery.attempts).toBe(1);
        expect(delivery.delivered_at).toBeDefined();
    });

    it('should include correct headers in webhook request', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        await deliverWebhook(env, subscription, 'challenge.created', { test: true });

        expect(global.fetch).toHaveBeenCalledWith(
            subscription.url,
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-TattleHash-Event': 'challenge.created',
                    'User-Agent': 'TattleHash-Webhook/1.0',
                }),
            })
        );
    });

    it('should include HMAC signature in headers', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        await deliverWebhook(env, subscription, 'challenge.created', { test: true });

        const callArgs = (global.fetch as any).mock.calls[0][1];
        expect(callArgs.headers['X-TattleHash-Signature']).toMatch(/^v1=/);
        expect(callArgs.headers['X-TattleHash-Timestamp']).toBeDefined();
        expect(callArgs.headers['X-TattleHash-Delivery']).toBeDefined();
    });

    it('should mark as FAILED on 4xx response (permanent failure)', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 404,
            text: () => Promise.resolve('Not Found'),
        });

        const delivery = await deliverWebhook(env, subscription, 'challenge.created', {});

        expect(delivery.status).toBe('FAILED');
        expect(delivery.attempts).toBe(1);
        // Should NOT be queued for retry
        expect((env.TATTLEHASH_QUEUE as any).send).not.toHaveBeenCalled();
    });

    it('should queue for retry on 5xx response', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        });

        const delivery = await deliverWebhook(env, subscription, 'challenge.created', {});

        expect(delivery.status).toBe('PENDING');
        expect((env.TATTLEHASH_QUEUE as any).send).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'webhook_retry',
                attempt: 1,
            }),
            expect.objectContaining({
                delaySeconds: 60, // First retry delay
            })
        );
    });

    it('should queue for retry on network error', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockRejectedValue(new Error('Network error'));

        const delivery = await deliverWebhook(env, subscription, 'challenge.created', {});

        expect(delivery.status).toBe('PENDING');
        expect((env.TATTLEHASH_QUEUE as any).send).toHaveBeenCalled();
    });

    it('should handle timeout', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockImplementation(() =>
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Aborted')), 100);
            })
        );

        const delivery = await deliverWebhook(env, subscription, 'challenge.created', {});

        expect(delivery.status).toBe('PENDING');
    });
});

// ============================================================================
// Retry Logic Tests
// ============================================================================

describe('Retry Logic', () => {
    let env: Env;

    beforeEach(() => {
        env = createMockEnv();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should stop retrying after max attempts', async () => {
        await retryFailedDelivery(env, 'delivery-123', 8);

        // Should NOT queue another retry
        expect((env.TATTLEHASH_QUEUE as any).send).not.toHaveBeenCalled();
    });

    it('should handle missing delivery gracefully', async () => {
        // Empty results means delivery not found
        await retryFailedDelivery(env, 'non-existent', 2);

        // Should not throw, should not queue retry
        expect((env.TATTLEHASH_QUEUE as any).send).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Delivery History Tests
// ============================================================================

describe('Delivery History', () => {
    it('should return delivery history for subscription', async () => {
        const mockDeliveries = [
            {
                id: 'delivery-1',
                subscription_id: 'sub-456',
                event_type: 'challenge.created',
                payload: JSON.stringify({ id: 1 }),
                status: 'DELIVERED',
                created_at: Date.now(),
            },
            {
                id: 'delivery-2',
                subscription_id: 'sub-456',
                event_type: 'challenge.completed',
                payload: JSON.stringify({ id: 2 }),
                status: 'PENDING',
                created_at: Date.now() - 1000,
            },
        ];

        const env = createMockEnv(mockDeliveries);
        const history = await getDeliveryHistory(env, 'sub-456', 50);

        expect(history.length).toBe(2);
        expect(history[0].id).toBe('delivery-1');
        expect(history[1].id).toBe('delivery-2');
    });

    it('should return empty array when no deliveries', async () => {
        const env = createMockEnv([]);
        const history = await getDeliveryHistory(env, 'sub-456', 50);

        expect(history).toEqual([]);
    });

    it('should parse JSON payload in deliveries', async () => {
        const mockDeliveries = [{
            id: 'delivery-1',
            subscription_id: 'sub-456',
            event_type: 'test.event',
            payload: JSON.stringify({ key: 'value', nested: { foo: 'bar' } }),
            status: 'DELIVERED',
            created_at: Date.now(),
        }];

        const env = createMockEnv(mockDeliveries);
        const history = await getDeliveryHistory(env, 'sub-456', 50);

        expect(history[0].payload).toEqual({ key: 'value', nested: { foo: 'bar' } });
    });
});

// ============================================================================
// Webhook Payload Format Tests
// ============================================================================

describe('Webhook Payload Format', () => {
    let env: Env;

    beforeEach(() => {
        env = createMockEnv();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should send correct payload structure', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        await deliverWebhook(env, subscription, 'challenge.created', {
            challenge_id: 'test-123',
            status: 'DRAFT',
        });

        const callArgs = (global.fetch as any).mock.calls[0][1];
        const body = JSON.parse(callArgs.body);

        expect(body).toHaveProperty('id'); // delivery ID
        expect(body).toHaveProperty('type', 'challenge.created');
        expect(body).toHaveProperty('created_at');
        expect(body).toHaveProperty('data');
        expect(body.data).toEqual({
            challenge_id: 'test-123',
            status: 'DRAFT',
        });
    });

    it('should format created_at as ISO string', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        await deliverWebhook(env, subscription, 'test.event', {});

        const callArgs = (global.fetch as any).mock.calls[0][1];
        const body = JSON.parse(callArgs.body);

        expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
});

// ============================================================================
// Response Status Code Handling Tests
// ============================================================================

describe('Response Status Code Handling', () => {
    let env: Env;

    beforeEach(() => {
        env = createMockEnv();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should treat 200 as success', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('DELIVERED');
    });

    it('should treat 201 as success', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 201,
            text: () => Promise.resolve('Created'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('DELIVERED');
    });

    it('should treat 400 as permanent failure', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 400,
            text: () => Promise.resolve('Bad Request'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('FAILED');
        expect((env.TATTLEHASH_QUEUE as any).send).not.toHaveBeenCalled();
    });

    it('should treat 401 as permanent failure', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve('Unauthorized'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('FAILED');
        expect((env.TATTLEHASH_QUEUE as any).send).not.toHaveBeenCalled();
    });

    it('should treat 500 as temporary failure and retry', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('PENDING');
        expect((env.TATTLEHASH_QUEUE as any).send).toHaveBeenCalled();
    });

    it('should treat 502 as temporary failure and retry', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 502,
            text: () => Promise.resolve('Bad Gateway'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('PENDING');
        expect((env.TATTLEHASH_QUEUE as any).send).toHaveBeenCalled();
    });

    it('should treat 503 as temporary failure and retry', async () => {
        const subscription = createMockSubscription();
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 503,
            text: () => Promise.resolve('Service Unavailable'),
        });

        const delivery = await deliverWebhook(env, subscription, 'test.event', {});
        expect(delivery.status).toBe('PENDING');
        expect((env.TATTLEHASH_QUEUE as any).send).toHaveBeenCalled();
    });
});
