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
 */
export function makeReceipt(env: Env, initiatorCommit: string): AttestRecord {
    return {
        id: crypto.randomUUID(),
        mode: 'pending',
        initiatorCommit,
        receivedAt: Date.now(),
        policyVersion: env.POLICY_VERSION || 'shield-v1',
    };
}
