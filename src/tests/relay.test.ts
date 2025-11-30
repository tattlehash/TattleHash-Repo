
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitEvent } from '../relay/events';
import { deliverWebhook } from '../relay/webhooks';
import { Env } from '../types';

describe('Relay System', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;
    let mockQueue: any;

    beforeEach(() => {
        mockDb = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
        };
        mockKv = {
            put: vi.fn(),
            get: vi.fn(),
            delete: vi.fn(),
            list: vi.fn().mockResolvedValue({ keys: [] }),
        };
        mockQueue = {
            send: vi.fn(),
        };

        env = {
            TATTLEHASH_DB: mockDb,
            GATE_KV: mockKv,
            ATT_KV: mockKv,
            TATTLEHASH_QUEUE: mockQueue,
            TATTLEHASH_KV: mockKv,
            TATTLEHASH_CONTENT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
            TATTLEHASH_ERROR_KV: mockKv,
            SHIELD_KV: mockKv,
        };

        // Mock fetch for webhook delivery
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('OK'),
        });
    });

    it('should emit event and trigger webhook delivery', async () => {
        // Mock active subscription
        mockDb.all.mockResolvedValue({
            results: [{
                id: 'sub_1',
                url: 'https://example.com/webhook',
                secret: 'test_secret',
                events: ['challenge.created'],
                active: 1,
                created_at: Date.now()
            }]
        });

        const event = {
            type: 'challenge.created',
            challenge_id: 'chal_123',
            data: { foo: 'bar' }
        };

        await emitEvent(env, event);

        // Should query subscriptions
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM webhooks'));

        // Should attempt delivery (fetch)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://example.com/webhook',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-TattleHash-Event': 'challenge.created',
                    'X-TattleHash-Signature': expect.any(String)
                })
            })
        );

        // Should store event in KV
        expect(mockKv.put).toHaveBeenCalledWith(
            expect.stringMatching(/^event:/),
            expect.stringContaining('"type":"challenge.created"'),
            expect.any(Object)
        );
    });

    it('should retry failed delivery via queue', async () => {
        // Mock fetch failure
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        });

        const subscription = {
            id: 'sub_1',
            user_id: 'user_123',
            url: 'https://example.com/webhook',
            secret: 'test_secret',
            events: ['*'],
            active: true,
            created_at: Date.now()
        };

        const event = { type: 'test.event' };

        await deliverWebhook(env, subscription, 'test.event', event);

        // Should record failure in DB
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO webhook_deliveries'));

        // Should enqueue retry with delay per ADR-007
        expect(mockQueue.send).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'webhook_retry',
                delivery_id: expect.any(String),
                subscription_id: 'sub_1',
                event_type: 'test.event',
                payload: expect.any(Object),
                attempt: 1,
            }),
            expect.objectContaining({
                delaySeconds: 60, // First retry delay per ADR-007
            })
        );
    });
});
