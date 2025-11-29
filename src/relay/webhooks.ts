
import { execute } from '../db';
import { sha256 } from '../utils/crypto';
import type { WebhookSubscription, WebhookDelivery } from './types';
import { Env } from '../types';

const MAX_RETRY_ATTEMPTS = 3;

export async function deliverWebhook(
    env: Env,
    subscription: WebhookSubscription,
    eventType: string,
    payload: Record<string, unknown>
): Promise<WebhookDelivery> {
    const deliveryId = crypto.randomUUID();

    // Create delivery record
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO webhook_deliveries (
      id, subscription_id, event_type, payload, status, attempts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [deliveryId, subscription.id, eventType, JSON.stringify(payload), 'PENDING', 0, Date.now()]
    );

    // Attempt delivery
    try {
        await attemptDelivery(env, subscription, eventType, payload, deliveryId);

        return {
            id: deliveryId,
            subscription_id: subscription.id,
            event_type: eventType,
            payload,
            status: 'DELIVERED',
            attempts: 1,
            delivered_at: Date.now(),
            created_at: Date.now(),
        };
    } catch (error) {
        // Queue for retry
        await env.TATTLEHASH_QUEUE.send({
            type: 'webhook_retry',
            delivery_id: deliveryId,
            subscription_id: subscription.id,
            event_type: eventType,
            payload,
            attempt: 1,
        });

        return {
            id: deliveryId,
            subscription_id: subscription.id,
            event_type: eventType,
            payload,
            status: 'FAILED',
            attempts: 1,
            last_attempt_at: Date.now(),
            created_at: Date.now(),
        };
    }
}

async function attemptDelivery(
    env: Env,
    subscription: WebhookSubscription,
    eventType: string,
    payload: Record<string, unknown>,
    deliveryId: string
): Promise<void> {
    // Create HMAC signature
    const timestamp = Date.now();
    const signaturePayload = `${timestamp}.${JSON.stringify(payload)}`;
    const signatureBytes = await sha256(signaturePayload + subscription.secret);
    const signature = Array.from(signatureBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Send webhook
    const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-TattleHash-Event': eventType,
            'X-TattleHash-Signature': signature,
            'X-TattleHash-Timestamp': timestamp.toString(),
            'X-TattleHash-Delivery': deliveryId,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status}`);
    }

    // Update delivery record
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE webhook_deliveries 
     SET status = 'DELIVERED', delivered_at = ?, attempts = attempts + 1
     WHERE id = ?`,
        [Date.now(), deliveryId]
    );
}

export async function retryFailedDelivery(
    env: Env,
    deliveryId: string,
    attempt: number
): Promise<void> {
    if (attempt >= MAX_RETRY_ATTEMPTS) {
        // Max retries reached - mark as permanently failed
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries SET status = 'FAILED' WHERE id = ?`,
            [deliveryId]
        );
        return;
    }

    // Get delivery and subscription
    const delivery = await env.TATTLEHASH_DB.prepare(
        'SELECT * FROM webhook_deliveries WHERE id = ?'
    ).bind(deliveryId).first<WebhookDelivery>();

    if (!delivery) return;

    const subscription = await env.TATTLEHASH_DB.prepare(
        'SELECT * FROM webhooks WHERE id = ?'
    ).bind(delivery.subscription_id).first<WebhookSubscription>();

    if (!subscription || !subscription.active) return;

    // Retry delivery
    try {
        await attemptDelivery(
            env,
            subscription,
            delivery.event_type,
            typeof delivery.payload === 'string' ? JSON.parse(delivery.payload) : delivery.payload,
            deliveryId
        );
    } catch (error) {
        // Schedule next retry with exponential backoff
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s

        await env.TATTLEHASH_QUEUE.send({
            type: 'webhook_retry',
            delivery_id: deliveryId,
            subscription_id: delivery.subscription_id,
            event_type: delivery.event_type,
            payload: JSON.parse(delivery.payload as unknown as string),
            attempt: attempt + 1,
        }, { delaySeconds: Math.floor(backoffMs / 1000) });

        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries 
       SET attempts = ?, last_attempt_at = ?
       WHERE id = ?`,
            [attempt + 1, Date.now(), deliveryId]
        );
    }
}
