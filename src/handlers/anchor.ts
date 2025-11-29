import { ok, err } from '../lib/http';
import { Env } from '../types';
import { queryTransactionStatus } from '../anchor';

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

export async function postAnchorPoll(req: Request, env: Env): Promise<Response> {
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
