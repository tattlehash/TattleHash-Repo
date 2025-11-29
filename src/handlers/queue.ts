import { Env } from '../types';
import { retryFailedDelivery } from '../relay/webhooks';

interface QueueMessageBody {
    type: string;
    [key: string]: unknown;
}

export async function handleQueueMessage(
    batch: MessageBatch,
    env: Env
): Promise<void> {
    const message = batch as MessageBatch<QueueMessageBody>;
    for (const msg of message.messages) {
        try {
            const body = msg.body;

            switch (body.type) {
                case 'governance':
                    await handleGovernanceJob(body, env);
                    break;

                case 'webhook_retry':
                    await handleWebhookRetry(body, env);
                    break;

                case 'anchor':
                    await handleAnchorJob(body, env);
                    break;

                default:
                    // Log unknown message types for debugging
                    console.log(`Unknown queue message type: ${body.type}`);
                    await env.TATTLEHASH_ERROR_KV.put(
                        `queue:unknown:${msg.id}`,
                        JSON.stringify(body),
                        { expirationTtl: 3600 }
                    );
            }

            msg.ack();
        } catch (error) {
            console.error('Queue message processing error:', error);
            msg.retry();
        }
    }
}

async function handleGovernanceJob(
    body: QueueMessageBody,
    env: Env
): Promise<void> {
    const payload = body.payload as { policyUpdate: unknown; payloadHash: string } | undefined;
    if (!payload) return;

    // Store governance update record
    await env.TATTLEHASH_KV.put(
        `governance:${payload.payloadHash}`,
        JSON.stringify({
            policyUpdate: payload.policyUpdate,
            processedAt: Date.now(),
        }),
        { expirationTtl: 86400 * 30 } // 30 days
    );
}

async function handleWebhookRetry(
    body: QueueMessageBody,
    env: Env
): Promise<void> {
    const deliveryId = body.delivery_id as string | undefined;
    const attempt = body.attempt as number | undefined;

    if (!deliveryId || attempt === undefined) return;

    await retryFailedDelivery(env, deliveryId, attempt);
}

async function handleAnchorJob(
    body: QueueMessageBody,
    env: Env
): Promise<void> {
    const receiptId = body.receiptId as string | undefined;
    if (!receiptId) return;

    // TODO: Implement actual anchoring logic
    // For now, just mark as processed
    await env.TATTLEHASH_KV.put(
        `anchor:job:${receiptId}`,
        JSON.stringify({
            status: 'processed',
            processedAt: Date.now(),
        }),
        { expirationTtl: 3600 }
    );
}
