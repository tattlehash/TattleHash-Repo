/**
 * Attestation Handlers
 *
 * SECURITY DESIGN DECISION: POST /attest is INTENTIONALLY PUBLIC
 *
 * Rationale:
 * - Attestation is a core primitive that allows anyone to submit data for timestamping
 * - Similar to how Certificate Transparency logs accept submissions from anyone
 * - The attestation itself contains only a hash commitment, not sensitive data
 * - Protection via rate limiting (100 requests/minute per IP) prevents abuse
 * - Each attestation creates a receipt that can be verified later
 *
 * If authentication is later required, uncomment the requireAuth section below.
 *
 * Rate Limits (defined in middleware/ratelimit.ts):
 * - Public endpoints: 100 requests/minute per IP
 * - This provides adequate protection against abuse while allowing legitimate use
 */

import { ok, err } from "../lib/http";
import { makeReceipt } from "../models/receipt";
import { enqueue } from "../jobs/queue";
import { recKey } from "../lib/kv";
import { Env } from "../types";
import { checkUserRateLimit } from "../middleware/ratelimit";
import { tryAuthenticate } from "../middleware/auth";
import { execute, query } from "../db";

/**
 * POST /attest - Create an attestation receipt
 *
 * PUBLIC ENDPOINT (by design) - Protected by rate limiting only.
 * If user is authenticated, the attestation is tracked in their account.
 *
 * Creates a timestamped receipt for the provided initiatorCommit hash.
 * The receipt is queued for blockchain anchoring.
 *
 * @param initiatorCommit - Optional hash commitment from the initiator
 * @returns Receipt with unique ID and timestamp
 */
export async function postAttest(req: Request, env: Env): Promise<Response> {
    // NOTE: This endpoint is intentionally public. See security rationale above.
    // But if user is authenticated, we track the attestation in their account.
    const authContext = await tryAuthenticate(req, env);
    const userId = authContext?.userId;

    // Beta limit: 10 attestations per day per user/IP
    const dailyLimitResult = await checkUserRateLimit(req, env, 'attestation_daily');
    if (!dailyLimitResult.ok) {
        return dailyLimitResult.response;
    }

    let body: Record<string, unknown> = {};
    try {
        body = await req.json() as Record<string, unknown>;
    } catch {
        // Empty body is acceptable - initiatorCommit is optional
    }

    const initiatorCommit = typeof body?.initiatorCommit === 'string'
        ? body.initiatorCommit
        : undefined;

    const receipt = makeReceipt(env, initiatorCommit);
    const now = Date.now();

    await env.ATT_KV.put(recKey(env, receipt.id), JSON.stringify(receipt));
    await enqueue(env, { type: 'anchor', id: crypto.randomUUID(), receiptId: receipt.id });

    // If user is authenticated, track this attestation in their account
    if (userId) {
        try {
            await execute(
                env.TATTLEHASH_DB,
                `INSERT INTO user_attestations (id, user_id, receipt_id, content_hash, anchor_status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
                [crypto.randomUUID(), userId, receipt.id, initiatorCommit || null, now, now]
            );
        } catch (e) {
            // Don't fail the attestation if tracking fails
            console.error('Failed to track user attestation:', e);
        }
    }

    return ok({ ok: true, receipt });
}

/**
 * GET /attestations - List user's attestations
 *
 * Requires authentication. Returns attestations for the authenticated user.
 */
export async function getAttestations(req: Request, env: Env): Promise<Response> {
    const authContext = await tryAuthenticate(req, env);
    if (!authContext) {
        return err(401, 'UNAUTHORIZED', { message: 'Authentication required' });
    }

    const attestations = await query<{
        id: string;
        receipt_id: string;
        content_hash: string | null;
        anchor_status: string;
        anchor_tx_hash: string | null;
        created_at: number;
    }>(
        env.TATTLEHASH_DB,
        `SELECT id, receipt_id, content_hash, anchor_status, anchor_tx_hash, created_at
         FROM user_attestations
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
        [authContext.userId]
    );

    return ok(attestations.map(a => ({
        id: a.id,
        receipt_id: a.receipt_id,
        content_hash: a.content_hash,
        anchor_status: a.anchor_status,
        anchor_tx_hash: a.anchor_tx_hash,
        created_at: new Date(a.created_at).toISOString(),
    })));
}
