
import { query } from '../db';
import { deliverWebhook } from './webhooks';
import type { WebhookSubscription } from './types';
import { Env } from '../types';

export async function emitEvent(
    env: Env,
    event: {
        type: string;
        challenge_id?: string;
        [key: string]: unknown;
    }
): Promise<void> {
    // Get all active subscriptions for this event type
    const subscriptions = await query<WebhookSubscription>(
        env.TATTLEHASH_DB,
        `SELECT * FROM webhooks WHERE active = 1`,
        []
    );

    // Filter subscriptions that listen to this event
    const relevantSubs = subscriptions.filter(sub =>
        sub.events.includes(event.type) || sub.events.includes('*')
    );

    // Deliver to all relevant webhooks
    await Promise.allSettled(
        relevantSubs.map(sub =>
            deliverWebhook(env, sub, event.type, event)
        )
    );

    // Store event in KV for recent events API
    await env.GATE_KV.put(
        `event:${crypto.randomUUID()}`,
        JSON.stringify({
            type: event.type,
            data: event,
            timestamp: Date.now(),
        }),
        { expirationTtl: 86400 * 7 } // 7 days
    );
}
