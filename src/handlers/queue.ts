import { Env } from '../types';
import { retryFailedDelivery } from '../relay/webhooks';
import { runAnalysis, scanUrls, CreateAnalysisInput } from '../monitoring';
import { anchorRecord } from '../anchor/service';
import type { AttestRecord } from '../anchor/storage';
import { recKey } from '../lib/kv';
import { execute } from '../db';

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

                case 'llm_analysis':
                    await handleLlmAnalysisJob(body, env);
                    break;

                case 'url_scan':
                    await handleUrlScanJob(body, env);
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
    if (!receiptId) {
        console.error('Anchor job missing receiptId');
        return;
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'anchor_job_started',
        receipt_id: receiptId,
    }));

    // Get the receipt from KV
    const receiptKey = recKey(env, receiptId);
    const receiptData = await env.ATT_KV.get(receiptKey);

    if (!receiptData) {
        console.error(`Receipt not found: ${receiptId}`);
        return;
    }

    const receipt = JSON.parse(receiptData) as AttestRecord;

    // Skip if already anchored
    if (receipt.mode === 'anchored') {
        console.log(`Receipt already anchored: ${receiptId}`);
        return;
    }

    // Create anchor job
    const anchorJob = {
        id: body.id as string || crypto.randomUUID(),
        receiptId,
        chain: 'polygon' as const,
        createdAt: Date.now(),
        attempts: (body.attempts as number) || 0,
    };

    // Anchor the record
    const result = await anchorRecord(env, anchorJob, receipt);

    if (result.ok && result.txHash) {
        // Update receipt with anchor info
        receipt.mode = 'anchored';
        receipt.txHash = result.txHash;

        // Save updated receipt
        await env.ATT_KV.put(receiptKey, JSON.stringify(receipt));

        // Update any challenges linked to this receipt with the anchor tx hash
        try {
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenges SET anchor_tx_hash = ?, updated_at = ? WHERE receipt_id = ?`,
                [result.txHash, Date.now(), receiptId]
            );
        } catch (dbError) {
            // Log but don't fail - the receipt is already anchored
            console.error('Failed to update challenge with anchor tx:', dbError);
        }

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'anchor_job_completed',
            receipt_id: receiptId,
            tx_hash: result.txHash,
        }));
    } else {
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'anchor_job_failed',
            receipt_id: receiptId,
            error: result.error,
        }));

        // Store failure for retry/debugging
        await env.TATTLEHASH_ERROR_KV.put(
            `anchor:error:${receiptId}`,
            JSON.stringify({
                receiptId,
                error: result.error,
                failedAt: Date.now(),
            }),
            { expirationTtl: 86400 } // 24 hours
        );
    }
}

async function handleLlmAnalysisJob(
    body: QueueMessageBody,
    env: Env
): Promise<void> {
    const input = body.input as CreateAnalysisInput | undefined;
    const targetData = body.target_data as Record<string, unknown> | undefined;
    const userId = body.user_id as string | undefined;

    if (!input || !targetData) {
        console.error('LLM analysis job missing required fields');
        return;
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'llm_analysis_job_started',
        target_type: input.target_type,
        target_id: input.target_id,
    }));

    try {
        const result = await runAnalysis(env, input, targetData, userId);

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'llm_analysis_job_completed',
            analysis_id: result.analysis_id,
            status: result.status,
            risk_score: result.risk_score,
        }));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('LLM analysis job failed:', message);

        // Store failure record for debugging
        await env.TATTLEHASH_ERROR_KV.put(
            `llm:analysis:error:${input.target_id}`,
            JSON.stringify({
                input,
                error: message,
                failedAt: Date.now(),
            }),
            { expirationTtl: 86400 } // 24 hours
        );
    }
}

async function handleUrlScanJob(
    body: QueueMessageBody,
    env: Env
): Promise<void> {
    const urls = body.urls as string[] | undefined;
    const rawContext = body.context as {
        analysis_id?: string;
        target_type?: string;
        target_id?: string;
    } | undefined;

    // Type-safe context conversion
    const context = rawContext ? {
        analysis_id: rawContext.analysis_id,
        target_type: rawContext.target_type as 'CHALLENGE' | 'DISPUTE' | 'ENF_BUNDLE' | 'USER' | 'TRANSACTION' | undefined,
        target_id: rawContext.target_id,
    } : undefined;

    if (!urls || urls.length === 0) {
        console.error('URL scan job missing URLs');
        return;
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'url_scan_job_started',
        url_count: urls.length,
    }));

    try {
        const results = await scanUrls(env, urls, context);

        const maliciousCount = results.filter(r => r.status === 'MALICIOUS').length;
        const suspiciousCount = results.filter(r => r.status === 'SUSPICIOUS').length;

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'url_scan_job_completed',
            url_count: urls.length,
            malicious: maliciousCount,
            suspicious: suspiciousCount,
        }));
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('URL scan job failed:', message);

        await env.TATTLEHASH_ERROR_KV.put(
            `llm:url_scan:error:${Date.now()}`,
            JSON.stringify({
                urls,
                error: message,
                failedAt: Date.now(),
            }),
            { expirationTtl: 86400 }
        );
    }
}
