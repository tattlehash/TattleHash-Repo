/**
 * Anchor service - orchestrates blockchain anchoring with batching.
 *
 * Features:
 * - Merkle tree batching for multiple attestations
 * - Multi-mode support: mock, relay, direct
 * - Polygon as primary chain (extensible to others)
 * - Transaction status polling
 */

import type { Env } from '../types';
import type { AttestRecord, AnchorJob } from './storage';
import { getReceipt, putReceipt, listAnchorJobs, getJob } from './storage';
import { buildMerkleTree, createLeafData, type MerkleTree } from './merkle';
import { createChainProvider, type ChainProvider, type TransactionStatus, type ChainId } from './chains';

/**
 * Anchor batch result.
 */
export interface AnchorBatchResult {
    txHash: string;
    chainId: ChainId;
    merkleRoot: string;
    receiptIds: string[];
    submittedAt: number;
}

/**
 * Anchor mode from environment.
 */
type AnchorMode = 'mock' | 'relay' | 'direct';

/**
 * Get the current anchor mode.
 */
function getAnchorMode(env: Env): AnchorMode {
    const mode = env.ANCHOR_MODE || 'mock';
    if (mode === 'mock' || mode === 'relay' || mode === 'direct') {
        return mode;
    }
    // Default to mock for testing
    if (env.NODE_ENV === 'test') {
        return 'mock';
    }
    return 'mock';
}

/**
 * Get chain provider based on environment.
 */
function getChainProvider(env: Env, chainId: ChainId = 'polygon'): ChainProvider | null {
    const rpcUrl = chainId === 'polygon'
        ? env.WEB3_RPC_URL_POLYGON
        : chainId === 'ethereum'
            ? env.RPC_ETH_MAIN
            : env.RPC_BASE_MAIN;

    if (!rpcUrl) {
        return null;
    }

    return createChainProvider(chainId, rpcUrl);
}

/**
 * Get private key from environment.
 */
function getPrivateKey(env: Env): string | null {
    // Private key should be stored as a secret
    const key = (env as Record<string, unknown>).ANCHOR_PRIVATE_KEY as string | undefined;
    if (!key) return null;

    // Remove 0x prefix if present
    return key.startsWith('0x') ? key.slice(2) : key;
}

/**
 * Generate mock transaction hash.
 */
async function generateMockTxHash(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`mock:${data}:${Date.now()}`));
    return '0xmock_' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 60);
}

/**
 * Anchor a single attestation record.
 *
 * For backwards compatibility with existing flow.
 */
export async function anchorRecord(
    env: Env,
    job: AnchorJob,
    record: AttestRecord
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    const mode = getAnchorMode(env);

    // Mock mode - generate deterministic hash
    if (mode === 'mock') {
        const leafData = createLeafData(record.id, record.initiatorCommit, record.counterCommit);
        const txHash = await generateMockTxHash(leafData);
        return { ok: true, txHash };
    }

    // Relay mode - would call external service
    if (mode === 'relay') {
        // TODO: Implement relay to external anchoring service
        // For now, generate a simulated hash
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const txHash = '0xrelay_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        return { ok: true, txHash };
    }

    // Direct mode - submit to blockchain
    const provider = getChainProvider(env, job.chain);
    if (!provider) {
        return { ok: false, error: `No RPC URL configured for chain: ${job.chain}` };
    }

    const privateKey = getPrivateKey(env);
    if (!privateKey) {
        return { ok: false, error: 'ANCHOR_PRIVATE_KEY not configured' };
    }

    try {
        // Create leaf data and build single-item Merkle tree
        const leafData = createLeafData(record.id, record.initiatorCommit, record.counterCommit, record.receivedAt);
        const tree = await buildMerkleTree([leafData]);

        // Submit to chain
        const result = await provider.submitAnchor(tree.root, privateKey);

        return { ok: true, txHash: result.txHash };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Anchor submission failed:', message);
        return { ok: false, error: message };
    }
}

/**
 * Anchor a batch of attestation records.
 *
 * Collects pending records, builds Merkle tree, submits root to chain.
 */
export async function anchorBatch(
    env: Env,
    records: AttestRecord[],
    chainId: ChainId = 'polygon'
): Promise<AnchorBatchResult | { ok: false; error: string }> {
    if (records.length === 0) {
        return { ok: false, error: 'No records to anchor' };
    }

    const mode = getAnchorMode(env);

    // Create leaf data for each record
    const leafDataItems = records.map(record =>
        createLeafData(record.id, record.initiatorCommit, record.counterCommit, record.receivedAt)
    );

    // Build Merkle tree
    const tree = await buildMerkleTree(leafDataItems);

    let txHash: string;

    if (mode === 'mock') {
        txHash = await generateMockTxHash(tree.root);
    } else if (mode === 'relay') {
        // TODO: Implement relay
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        txHash = '0xrelay_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        // Direct mode
        const provider = getChainProvider(env, chainId);
        if (!provider) {
            return { ok: false, error: `No RPC URL configured for chain: ${chainId}` };
        }

        const privateKey = getPrivateKey(env);
        if (!privateKey) {
            return { ok: false, error: 'ANCHOR_PRIVATE_KEY not configured' };
        }

        try {
            const result = await provider.submitAnchor(tree.root, privateKey);
            txHash = result.txHash;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { ok: false, error: message };
        }
    }

    // Update all records with tx hash and Merkle proof
    const now = Date.now();
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const proof = tree.proofs[i];

        record.mode = 'anchored';
        record.txHash = txHash;
        record.final = JSON.stringify({
            merkleRoot: tree.root,
            leafHash: proof.leaf,
            proof: proof.proof,
            index: proof.index,
        });

        await putReceipt(env, record);
    }

    return {
        txHash,
        chainId,
        merkleRoot: tree.root,
        receiptIds: records.map(r => r.id),
        submittedAt: Date.now(),
    };
}

/**
 * Query transaction status from blockchain.
 */
export async function queryTransactionStatus(
    env: Env,
    txHash: string,
    chainId: ChainId = 'polygon'
): Promise<TransactionStatus> {
    const mode = getAnchorMode(env);

    // Mock mode - always return confirmed
    if (mode === 'mock' || txHash.startsWith('0xmock_')) {
        return {
            txHash,
            confirmed: true,
            confirmations: 128,
            reorged: false,
            failed: false,
        };
    }

    // Relay mode - would query relay service
    if (mode === 'relay' || txHash.startsWith('0xrelay_')) {
        // TODO: Implement relay status query
        return {
            txHash,
            confirmed: true,
            confirmations: 12,
            reorged: false,
            failed: false,
        };
    }

    // Direct mode - query blockchain
    const provider = getChainProvider(env, chainId);
    if (!provider) {
        return {
            txHash,
            confirmed: false,
            confirmations: 0,
            reorged: false,
            failed: false,
        };
    }

    try {
        return await provider.getTransactionStatus(txHash);
    } catch (error) {
        console.error('Failed to query tx status:', error);
        return {
            txHash,
            confirmed: false,
            confirmations: 0,
            reorged: false,
            failed: false,
        };
    }
}

/**
 * Process pending anchor jobs in a batch.
 *
 * Called by the cron sweep handler.
 */
export async function processPendingAnchors(
    env: Env,
    maxBatchSize: number = 50
): Promise<{ processed: number; failed: number; txHash?: string }> {
    // List pending jobs
    const jobList = await listAnchorJobs(env);
    if (jobList.keys.length === 0) {
        return { processed: 0, failed: 0 };
    }

    // Load jobs and their receipts
    const pendingRecords: AttestRecord[] = [];
    const jobs: AnchorJob[] = [];

    for (const key of jobList.keys.slice(0, maxBatchSize)) {
        const jobId = key.name.split(':').pop();
        if (!jobId) continue;

        const job = await getJob(env, jobId);
        if (!job) continue;

        const record = await getReceipt(env, job.receiptId);
        if (!record) continue;

        // Skip already anchored
        if (record.mode === 'anchored') continue;

        // Only process pending or confirmed
        if (record.mode !== 'pending' && record.mode !== 'confirmed') continue;

        jobs.push(job);
        pendingRecords.push(record);
    }

    if (pendingRecords.length === 0) {
        return { processed: 0, failed: 0 };
    }

    // Anchor the batch
    const result = await anchorBatch(env, pendingRecords);

    if ('ok' in result && !result.ok) {
        console.error('Batch anchor failed:', result.error);
        return { processed: 0, failed: pendingRecords.length };
    }

    // Clean up processed jobs
    for (const job of jobs) {
        await env.TATTLEHASH_ANCHOR_KV.delete(`anchor:jobs:${job.id}`);
    }

    return {
        processed: pendingRecords.length,
        failed: 0,
        txHash: 'txHash' in result ? result.txHash : undefined,
    };
}
