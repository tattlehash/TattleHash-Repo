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

/**
 * POST /attest - Create an attestation receipt
 *
 * PUBLIC ENDPOINT (by design) - Protected by rate limiting only.
 *
 * Creates a timestamped receipt for the provided initiatorCommit hash.
 * The receipt is queued for blockchain anchoring.
 *
 * @param initiatorCommit - Optional hash commitment from the initiator
 * @returns Receipt with unique ID and timestamp
 */
export async function postAttest(req: Request, env: Env): Promise<Response> {
    // NOTE: This endpoint is intentionally public. See security rationale above.
    // To require auth, uncomment:
    // const authResponse = await requireAuth(req, env);
    // if (authResponse) return authResponse;

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

    await env.ATT_KV.put(recKey(env, receipt.id), JSON.stringify(receipt));
    await enqueue(env, { id: crypto.randomUUID(), receiptId: receipt.id });

    return ok({ ok: true, receipt });
}
