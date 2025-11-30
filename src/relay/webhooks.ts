
import { execute, queryOne } from '../db';
import { sha256 } from '../utils/crypto';
import type { WebhookSubscription, WebhookDelivery, DeliveryAttempt } from './types';
import { Env } from '../types';

/**
 * Retry Policy (ADR-007)
 *
 * 8 attempts over ~24 hours:
 * - Attempt 1: Immediate
 * - Attempt 2: 1 minute delay
 * - Attempt 3: 5 minutes delay
 * - Attempt 4: 15 minutes delay
 * - Attempt 5: 60 minutes delay
 * - Attempt 6: 4 hours delay
 * - Attempt 7: 4 hours delay
 * - Attempt 8: 4 hours delay
 *
 * Response handling:
 * - 2xx = Success
 * - 4xx = Permanent failure (no retry)
 * - 5xx = Temporary failure (retry)
 */

const MAX_RETRY_ATTEMPTS = 8;

// Backoff delays in seconds
const RETRY_DELAYS_SECONDS = [
    0,      // Attempt 1: immediate
    60,     // Attempt 2: 1 minute
    300,    // Attempt 3: 5 minutes
    900,    // Attempt 4: 15 minutes
    3600,   // Attempt 5: 60 minutes
    14400,  // Attempt 6: 4 hours
    14400,  // Attempt 7: 4 hours
    14400,  // Attempt 8: 4 hours
];

export type DeliveryResult = {
    success: boolean;
    statusCode?: number;
    error?: string;
    permanentFailure?: boolean;
};

export async function deliverWebhook(
    env: Env,
    subscription: WebhookSubscription,
    eventType: string,
    payload: Record<string, unknown>
): Promise<WebhookDelivery> {
    const deliveryId = crypto.randomUUID();
    const now = Date.now();

    // Create delivery record
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO webhook_deliveries (
            id, subscription_id, event_type, payload, status, attempts, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [deliveryId, subscription.id, eventType, JSON.stringify(payload), 'PENDING', 0, now]
    );

    // Attempt delivery
    const result = await attemptDelivery(env, subscription, eventType, payload, deliveryId);

    if (result.success) {
        return {
            id: deliveryId,
            subscription_id: subscription.id,
            event_type: eventType,
            payload,
            status: 'DELIVERED',
            attempts: 1,
            delivered_at: Date.now(),
            created_at: now,
        };
    }

    // Handle failure
    if (result.permanentFailure) {
        // 4xx response - don't retry
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries
             SET status = 'FAILED', attempts = 1, last_attempt_at = ?
             WHERE id = ?`,
            [Date.now(), deliveryId]
        );

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_permanent_failure',
            delivery_id: deliveryId,
            status_code: result.statusCode,
            error: result.error,
        }));

        return {
            id: deliveryId,
            subscription_id: subscription.id,
            event_type: eventType,
            payload,
            status: 'FAILED',
            attempts: 1,
            last_attempt_at: Date.now(),
            created_at: now,
        };
    }

    // Queue for retry (5xx or network error)
    const nextDelay = RETRY_DELAYS_SECONDS[1]; // First retry delay
    await env.TATTLEHASH_QUEUE.send({
        type: 'webhook_retry',
        delivery_id: deliveryId,
        subscription_id: subscription.id,
        event_type: eventType,
        payload,
        attempt: 1,
    }, { delaySeconds: nextDelay });

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE webhook_deliveries
         SET attempts = 1, last_attempt_at = ?, next_retry_at = ?
         WHERE id = ?`,
        [Date.now(), Date.now() + (nextDelay * 1000), deliveryId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_delivery_queued_for_retry',
        delivery_id: deliveryId,
        attempt: 1,
        next_retry_seconds: nextDelay,
    }));

    return {
        id: deliveryId,
        subscription_id: subscription.id,
        event_type: eventType,
        payload,
        status: 'PENDING',
        attempts: 1,
        last_attempt_at: Date.now(),
        created_at: now,
    };
}

async function attemptDelivery(
    env: Env,
    subscription: WebhookSubscription,
    eventType: string,
    payload: Record<string, unknown>,
    deliveryId: string
): Promise<DeliveryResult> {
    try {
        // Create HMAC signature
        const timestamp = Date.now();
        const signaturePayload = `${timestamp}.${JSON.stringify(payload)}`;
        const signatureBytes = await sha256(signaturePayload + subscription.secret);
        const signature = Array.from(signatureBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Send webhook with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(subscription.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-TattleHash-Event': eventType,
                'X-TattleHash-Signature': `v1=${signature}`,
                'X-TattleHash-Timestamp': timestamp.toString(),
                'X-TattleHash-Delivery': deliveryId,
                'User-Agent': 'TattleHash-Webhook/1.0',
            },
            body: JSON.stringify({
                id: deliveryId,
                type: eventType,
                created_at: new Date().toISOString(),
                data: payload,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check response status
        if (response.ok) {
            // 2xx - Success
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE webhook_deliveries
                 SET status = 'DELIVERED', delivered_at = ?, attempts = attempts + 1
                 WHERE id = ?`,
                [Date.now(), deliveryId]
            );

            console.log(JSON.stringify({
                t: Date.now(),
                at: 'webhook_delivered',
                delivery_id: deliveryId,
                status_code: response.status,
                url: subscription.url,
            }));

            return { success: true, statusCode: response.status };
        }

        // 4xx - Client error, permanent failure (don't retry)
        if (response.status >= 400 && response.status < 500) {
            const responseText = await response.text().catch(() => '');
            return {
                success: false,
                statusCode: response.status,
                error: responseText.slice(0, 200),
                permanentFailure: true,
            };
        }

        // 5xx - Server error, temporary failure (retry)
        const responseText = await response.text().catch(() => '');
        return {
            success: false,
            statusCode: response.status,
            error: responseText.slice(0, 200),
            permanentFailure: false,
        };
    } catch (error: any) {
        // Network error or timeout - retry
        return {
            success: false,
            error: error.message || 'Unknown error',
            permanentFailure: false,
        };
    }
}

export async function retryFailedDelivery(
    env: Env,
    deliveryId: string,
    attempt: number
): Promise<void> {
    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_retry_started',
        delivery_id: deliveryId,
        attempt,
    }));

    if (attempt >= MAX_RETRY_ATTEMPTS) {
        // Max retries reached - mark as permanently failed
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries SET status = 'FAILED', last_attempt_at = ? WHERE id = ?`,
            [Date.now(), deliveryId]
        );

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_max_retries_exceeded',
            delivery_id: deliveryId,
            attempts: attempt,
        }));
        return;
    }

    // Get delivery and subscription
    const delivery = await queryOne<any>(
        env.TATTLEHASH_DB,
        'SELECT * FROM webhook_deliveries WHERE id = ?',
        [deliveryId]
    );

    if (!delivery) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_retry_delivery_not_found',
            delivery_id: deliveryId,
        }));
        return;
    }

    const subscription = await queryOne<any>(
        env.TATTLEHASH_DB,
        'SELECT * FROM webhooks WHERE id = ?',
        [delivery.subscription_id]
    );

    if (!subscription) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_retry_subscription_not_found',
            delivery_id: deliveryId,
            subscription_id: delivery.subscription_id,
        }));
        // Mark as failed - subscription deleted
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries SET status = 'FAILED' WHERE id = ?`,
            [deliveryId]
        );
        return;
    }

    if (!subscription.active) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_retry_subscription_inactive',
            delivery_id: deliveryId,
            subscription_id: delivery.subscription_id,
        }));
        // Mark as failed - subscription disabled
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries SET status = 'FAILED' WHERE id = ?`,
            [deliveryId]
        );
        return;
    }

    // Parse subscription for proper format
    const parsedSubscription: WebhookSubscription = {
        ...subscription,
        events: typeof subscription.events === 'string'
            ? JSON.parse(subscription.events)
            : subscription.events,
        active: Boolean(subscription.active),
    };

    // Parse payload
    const payload = typeof delivery.payload === 'string'
        ? JSON.parse(delivery.payload)
        : delivery.payload;

    // Retry delivery
    const result = await attemptDelivery(
        env,
        parsedSubscription,
        delivery.event_type,
        payload,
        deliveryId
    );

    if (result.success) {
        // Successfully delivered on retry
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_retry_succeeded',
            delivery_id: deliveryId,
            attempt,
        }));
        return;
    }

    // Handle failure
    if (result.permanentFailure) {
        // 4xx - permanent failure, stop retrying
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE webhook_deliveries
             SET status = 'FAILED', attempts = ?, last_attempt_at = ?
             WHERE id = ?`,
            [attempt + 1, Date.now(), deliveryId]
        );

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'webhook_retry_permanent_failure',
            delivery_id: deliveryId,
            attempt,
            status_code: result.statusCode,
        }));
        return;
    }

    // Schedule next retry with exponential backoff per ADR-007
    const nextAttempt = attempt + 1;
    const delaySeconds = RETRY_DELAYS_SECONDS[nextAttempt] ?? RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1];

    await env.TATTLEHASH_QUEUE.send({
        type: 'webhook_retry',
        delivery_id: deliveryId,
        subscription_id: delivery.subscription_id,
        event_type: delivery.event_type,
        payload,
        attempt: nextAttempt,
    }, { delaySeconds });

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE webhook_deliveries
         SET attempts = ?, last_attempt_at = ?, next_retry_at = ?
         WHERE id = ?`,
        [nextAttempt, Date.now(), Date.now() + (delaySeconds * 1000), deliveryId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_retry_scheduled',
        delivery_id: deliveryId,
        attempt: nextAttempt,
        next_retry_seconds: delaySeconds,
        error: result.error,
    }));
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getRetryDelaySeconds(attempt: number): number {
    return RETRY_DELAYS_SECONDS[attempt] ?? RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1];
}

export async function getDeliveryStatus(
    env: Env,
    deliveryId: string
): Promise<WebhookDelivery | null> {
    const row = await queryOne<any>(
        env.TATTLEHASH_DB,
        'SELECT * FROM webhook_deliveries WHERE id = ?',
        [deliveryId]
    );

    if (!row) return null;

    return {
        ...row,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    };
}

export async function getDeliveryHistory(
    env: Env,
    subscriptionId: string,
    limit: number = 50
): Promise<WebhookDelivery[]> {
    const rows = await env.TATTLEHASH_DB.prepare(
        `SELECT * FROM webhook_deliveries
         WHERE subscription_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
    ).bind(subscriptionId, limit).all();

    return (rows.results as any[]).map(row => ({
        ...row,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    }));
}
