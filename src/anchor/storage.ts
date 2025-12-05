/**
 * Anchor storage functions - KV operations for jobs and receipts.
 */

import type { Env } from '../types';

/**
 * Attestation record modes.
 */
export type ModeState = 'pending' | 'confirmed' | 'anchored' | 'expired' | 'void' | 'refund';

/**
 * Anchor job for queuing.
 */
export type AnchorJob = {
    id: string;
    receiptId: string;
    createdAt: number;
    attempts: number;
    chain: 'ethereum' | 'arbitrum' | 'polygon' | 'base';
};

/**
 * Attestation record.
 *
 * Hash-Chain Enhancement (Patent: TraceAI v3.1):
 * Each attestation record includes a `previousHash` field that references
 * the final hash of the preceding attestation for a given user/scope.
 * This creates a linear chain of attestations that can be verified
 * independently of the Merkle tree anchoring.
 */
export type AttestRecord = {
    id: string;
    mode: 'pending' | 'confirmed' | 'anchored' | 'expired';
    initiatorCommit: string;
    counterCommit?: string;
    final?: string;
    receivedAt: number;
    policyVersion: string;
    txHash?: string;
    /**
     * Hash-chain reference to the previous attestation's final hash.
     * Creates a linear chain for sequential verification.
     * Null for the first attestation in a chain.
     */
    previousHash?: string | null;
    /**
     * Scope identifier for hash-chain grouping (e.g., user_id, challenge_id).
     * Attestations are chained within their scope.
     */
    chainScope?: string;
};

export const JOB_TTL_SEC = 60 * 60 * 24;

const DEFAULT_QUEUE_PREFIX = 'anchor:jobs:';
const DEFAULT_RECEIPT_PREFIX = 'attest:';

function jobKey(env: Env, id: string): string {
    return `${env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX}${id}`;
}

function receiptKey(env: Env, id: string): string {
    return `${env.RECEIPT_PREFIX || DEFAULT_RECEIPT_PREFIX}${id}`;
}

export async function enqueueAnchor(env: Env, job: AnchorJob): Promise<void> {
    await env.TATTLEHASH_ANCHOR_KV.put(jobKey(env, job.id), JSON.stringify(job), { expirationTtl: JOB_TTL_SEC });
}

export async function listAnchorJobs(env: Env, cursor?: string) {
    return env.TATTLEHASH_ANCHOR_KV.list({ prefix: env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX, cursor, limit: 100 });
}

export async function getJob(env: Env, id: string): Promise<AnchorJob | null> {
    const raw = await env.TATTLEHASH_ANCHOR_KV.get(jobKey(env, id));
    return raw ? (JSON.parse(raw) as AnchorJob) : null;
}

export async function deleteJob(env: Env, id: string): Promise<void> {
    await env.TATTLEHASH_ANCHOR_KV.delete(jobKey(env, id));
}

export async function getReceipt(env: Env, id: string): Promise<AttestRecord | null> {
    const raw = await env.ATT_KV.get(receiptKey(env, id));
    return raw ? (JSON.parse(raw) as AttestRecord) : null;
}

export async function putReceipt(env: Env, record: AttestRecord): Promise<void> {
    await env.ATT_KV.put(receiptKey(env, record.id), JSON.stringify(record));
}

/**
 * Create a new attestation receipt.
 *
 * @param env - Environment bindings
 * @param initiatorCommit - The initiator's content hash
 * @param options - Optional parameters for hash-chaining
 */
export function makeReceipt(
    env: Env,
    initiatorCommit: string,
    options?: {
        /** Previous attestation hash for chain linking */
        previousHash?: string | null;
        /** Scope identifier for hash-chain grouping */
        chainScope?: string;
    }
): AttestRecord {
    return {
        id: crypto.randomUUID(),
        mode: 'pending',
        initiatorCommit,
        receivedAt: Date.now(),
        policyVersion: env.POLICY_VERSION || 'shield-v1',
        previousHash: options?.previousHash ?? null,
        chainScope: options?.chainScope,
    };
}

// ============================================================================
// Hash-Chain Functions (Patent: TraceAI v3.1)
// ============================================================================

/**
 * Key pattern for storing the latest hash in a chain scope.
 */
function chainHeadKey(scope: string): string {
    return `chain:head:${scope}`;
}

/**
 * Get the latest attestation hash for a given scope.
 * Used to link new attestations to the existing chain.
 *
 * @param env - Environment bindings
 * @param scope - Chain scope identifier (e.g., user_id)
 * @returns The final hash of the most recent attestation in the chain, or null if first
 */
export async function getChainHead(env: Env, scope: string): Promise<string | null> {
    const head = await env.ATT_KV.get(chainHeadKey(scope));
    return head;
}

/**
 * Update the chain head to point to the new attestation.
 * Called after an attestation is finalized.
 *
 * @param env - Environment bindings
 * @param scope - Chain scope identifier
 * @param finalHash - The final hash of the newly anchored attestation
 */
export async function updateChainHead(
    env: Env,
    scope: string,
    finalHash: string
): Promise<void> {
    await env.ATT_KV.put(chainHeadKey(scope), finalHash);
}

/**
 * Create a new attestation receipt with automatic hash-chain linking.
 * This is the recommended way to create receipts that participate in hash-chains.
 *
 * @param env - Environment bindings
 * @param initiatorCommit - The initiator's content hash
 * @param chainScope - Scope identifier for hash-chain grouping (e.g., user_id)
 * @returns New attestation record linked to the chain
 */
export async function makeChainedReceipt(
    env: Env,
    initiatorCommit: string,
    chainScope: string
): Promise<AttestRecord> {
    // Get the previous hash in this chain
    const previousHash = await getChainHead(env, chainScope);

    return makeReceipt(env, initiatorCommit, {
        previousHash,
        chainScope,
    });
}

/**
 * Verify the hash-chain integrity for a sequence of attestations.
 * Checks that each attestation's previousHash matches the prior attestation's final hash.
 *
 * @param attestations - Array of attestation records in chronological order
 * @returns Verification result with any broken links
 */
export function verifyHashChain(
    attestations: AttestRecord[]
): { valid: boolean; brokenAt?: number; error?: string } {
    if (attestations.length === 0) {
        return { valid: true };
    }

    // First attestation should have null previousHash
    if (attestations[0].previousHash !== null && attestations[0].previousHash !== undefined) {
        return {
            valid: false,
            brokenAt: 0,
            error: 'First attestation in chain has non-null previousHash',
        };
    }

    // Check each subsequent attestation links to the previous
    for (let i = 1; i < attestations.length; i++) {
        const current = attestations[i];
        const previous = attestations[i - 1];

        // Previous attestation must have a final hash to link to
        if (!previous.final) {
            return {
                valid: false,
                brokenAt: i - 1,
                error: `Attestation at index ${i - 1} has no final hash`,
            };
        }

        // Current attestation's previousHash must match previous final
        if (current.previousHash !== previous.final) {
            return {
                valid: false,
                brokenAt: i,
                error: `Chain broken at index ${i}: previousHash (${current.previousHash}) does not match prior final (${previous.final})`,
            };
        }
    }

    return { valid: true };
}
