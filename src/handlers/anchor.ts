/**
 * Anchor Handlers
 *
 * SECURITY: Anchor polling requires user authentication to prevent abuse.
 * Unauthenticated users cannot query transaction confirmation status.
 */

import { ok, err } from '../lib/http';
import { Env } from '../types';
import { queryTransactionStatus } from '../anchor';
import { anchorRecord } from '../anchor/service';
import type { AttestRecord } from '../anchor/storage';
import { requireAuth } from '../middleware/auth';
import { recKey } from '../lib/kv';

type JsonDict = Record<string, unknown>;

async function safeJSON(req: Request, maxBytes = 512 * 1024): Promise<JsonDict> {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    const clone = req.clone();
    const buf = await clone.arrayBuffer();
    if (buf.byteLength > maxBytes) {
        throw { message: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', status: 413 };
    }
    const j: unknown = await req.json().catch(() => ({}));
    return j && typeof j === 'object' ? (j as JsonDict) : {};
}

interface PendingAnchor {
    txHash: string;
    chainId?: 'polygon' | 'ethereum' | 'arbitrum' | 'base' | 'optimism';
    confirmations?: number;
    final?: boolean;
    [key: string]: unknown;
}

// Query transaction status from blockchain
async function queryTxStatus(
    rec: PendingAnchor,
    env: Env
): Promise<{ confirmations: number; reorged?: boolean }> {
    const status = await queryTransactionStatus(env, rec.txHash, rec.chainId || 'polygon');
    return {
        confirmations: status.confirmations,
        reorged: status.reorged,
    };
}

/**
 * POST /anchor/poll - Poll for transaction confirmation status
 *
 * SECURITY: Requires user authentication via Bearer token.
 */
export async function postAnchorPoll(req: Request, env: Env): Promise<Response> {
    // Require user authentication
    const authResponse = await requireAuth(req, env);
    if (authResponse) {
        return authResponse;
    }

    try {
        const body = await safeJSON(req);
        const pending: PendingAnchor[] = Array.isArray(body?.pending)
            ? (body.pending as PendingAnchor[])
            : [];

        const updated: Array<{ txHash: string; final: boolean }> = [];

        for (const p of pending) {
            if (!p.txHash) continue;

            const s = await queryTxStatus(p, env).catch(() => null);
            if (!s) continue;

            if (s.confirmations >= 12 && !s.reorged) {
                p.confirmations = s.confirmations;
                p.final = true;
                await env.TATTLEHASH_ANCHOR_KV.put(
                    `anchor:tx:${p.txHash}`,
                    JSON.stringify(p)
                );
                updated.push({ txHash: p.txHash, final: true });
            }
        }

        return ok({ ok: true, updated });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}

/**
 * POST /admin/anchor/:receiptId - Manually anchor a receipt
 *
 * SECURITY: Admin-only endpoint for testing/debugging.
 */
export async function postManualAnchor(
    _req: Request,
    env: Env,
    receiptId: string
): Promise<Response> {
    console.log(JSON.stringify({
        t: Date.now(),
        at: 'manual_anchor_started',
        receipt_id: receiptId,
    }));

    // Get the receipt from KV
    const receiptKey = recKey(env, receiptId);
    const receiptData = await env.ATT_KV.get(receiptKey);

    if (!receiptData) {
        return err(404, 'RECEIPT_NOT_FOUND', { receipt_id: receiptId });
    }

    const receipt = JSON.parse(receiptData) as AttestRecord;

    // Check if already anchored
    if (receipt.mode === 'anchored' && receipt.txHash) {
        return ok({
            already_anchored: true,
            receipt_id: receiptId,
            tx_hash: receipt.txHash,
        });
    }

    // Create anchor job
    const anchorJob = {
        id: crypto.randomUUID(),
        receiptId,
        chain: 'polygon' as const,
        createdAt: Date.now(),
        attempts: 0,
    };

    // Anchor the record
    const result = await anchorRecord(env, anchorJob, receipt);

    if (result.ok && result.txHash) {
        // Update receipt with anchor info
        receipt.mode = 'anchored';
        receipt.txHash = result.txHash;

        // Save updated receipt
        await env.ATT_KV.put(receiptKey, JSON.stringify(receipt));

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'manual_anchor_completed',
            receipt_id: receiptId,
            tx_hash: result.txHash,
        }));

        return ok({
            anchored: true,
            receipt_id: receiptId,
            tx_hash: result.txHash,
        });
    } else {
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'manual_anchor_failed',
            receipt_id: receiptId,
            error: result.error,
        }));

        return err(500, 'ANCHOR_FAILED', {
            receipt_id: receiptId,
            error: result.error,
        });
    }
}
