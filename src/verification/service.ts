/**
 * Verification Service
 *
 * Core logic for verifying document hashes against blockchain anchors.
 */

import { query, queryOne } from '../db';
import type { Env } from '../types';
import type { EnfBundle } from '../db/types';
import { getReceipt, type AttestRecord } from '../anchor/storage';
import { queryTransactionStatus } from '../anchor/service';
import { verifyMerkleProof, type MerkleProof } from '../anchor/merkle';
import { CHAIN_CONFIGS, type ChainId } from '../anchor/chains/types';
import type {
    VerificationResult,
    VerificationStatus,
    BlockchainStatus,
    BlockchainAnchorDetails,
    MerkleProofDetails,
    SourceDocumentDetails,
    QuickVerificationResult,
    VerifyMerkleProofInput,
} from './types';
import {
    CHAIN_EXPLORER_URLS,
    CHAIN_NAMES,
    CHAIN_IDS,
} from './types';

// ============================================================================
// Hash Lookup Functions
// ============================================================================

/**
 * Look up an ENF bundle by evidence hash.
 */
async function findEnfBundleByHash(
    env: Env,
    hash: string
): Promise<EnfBundle | null> {
    // Try exact match first
    let bundle = await queryOne<EnfBundle>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_bundles WHERE evidence_hash = ?',
        [hash]
    );

    if (bundle) return bundle;

    // Try with 0x prefix if not present
    if (!hash.startsWith('0x')) {
        bundle = await queryOne<EnfBundle>(
            env.TATTLEHASH_DB,
            'SELECT * FROM enf_bundles WHERE evidence_hash = ?',
            ['0x' + hash]
        );
    }

    return bundle;
}

/**
 * Look up an attestation record by hash.
 * The hash could be the receipt ID or the initiator commit.
 */
async function findAttestationByHash(
    env: Env,
    hash: string
): Promise<AttestRecord | null> {
    // Try as receipt ID first
    let record = await getReceipt(env, hash);
    if (record) return record;

    // Try without 0x prefix
    const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash;
    record = await getReceipt(env, cleanHash);

    return record;
}

/**
 * Look up ENF bundle by ID.
 */
async function findEnfBundleById(
    env: Env,
    id: string
): Promise<EnfBundle | null> {
    return queryOne<EnfBundle>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_bundles WHERE id = ?',
        [id]
    );
}

// ============================================================================
// Blockchain Verification
// ============================================================================

/**
 * Get blockchain anchor details from an attestation record.
 */
async function getBlockchainDetails(
    env: Env,
    record: AttestRecord,
    chain: ChainId = 'polygon'
): Promise<BlockchainAnchorDetails | null> {
    if (!record.txHash) {
        return null;
    }

    const chainConfig = CHAIN_CONFIGS[chain];
    const explorerUrl = CHAIN_EXPLORER_URLS[chain] || 'https://polygonscan.com';

    // Query current transaction status
    const txStatus = await queryTransactionStatus(env, record.txHash, chain);

    let status: BlockchainStatus;
    if (txStatus.failed) {
        status = 'FAILED';
    } else if (txStatus.reorged) {
        status = 'REORGED';
    } else if (txStatus.confirmed) {
        status = 'CONFIRMED';
    } else {
        status = 'PENDING';
    }

    return {
        chain,
        chain_name: CHAIN_NAMES[chain] || chain,
        chain_id: CHAIN_IDS[chain] || 0,
        tx_hash: record.txHash,
        block_number: txStatus.blockNumber,
        block_hash: txStatus.blockHash,
        timestamp: record.receivedAt,
        confirmations: txStatus.confirmations,
        required_confirmations: chainConfig.confirmationsRequired,
        explorer_url: `${explorerUrl}/tx/${record.txHash}`,
        status,
    };
}

/**
 * Parse Merkle proof from attestation record final field.
 */
function parseMerkleProof(record: AttestRecord): MerkleProofDetails | null {
    if (!record.final) {
        return null;
    }

    try {
        const finalData = JSON.parse(record.final);
        if (!finalData.merkleRoot || !finalData.leafHash) {
            return null;
        }

        return {
            leaf_hash: finalData.leafHash,
            merkle_root: finalData.merkleRoot,
            proof_path: finalData.proof || [],
            leaf_index: finalData.index || 0,
            proof_valid: false, // Will be verified separately
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Main Verification Functions
// ============================================================================

/**
 * Verify a document by its hash.
 */
export async function verifyByHash(
    env: Env,
    hash: string,
    expectedType?: 'ENF_BUNDLE' | 'CHALLENGE' | 'ATTESTATION',
    expectedId?: string
): Promise<VerificationResult> {
    const verifiedAt = new Date().toISOString();
    const normalizedHash = hash.toLowerCase();

    // Initialize result
    const result: VerificationResult = {
        status: 'NOT_FOUND',
        verified: false,
        message: 'Document hash not found in the system',
        verified_at: verifiedAt,
        document_hash: hash,
        hash_algorithm: 'SHA-256',
    };

    // Try to find ENF bundle by evidence hash
    const enfBundle = await findEnfBundleByHash(env, normalizedHash);
    if (enfBundle) {
        result.source = {
            type: 'ENF_BUNDLE',
            id: enfBundle.id,
            title: enfBundle.title,
            created_at: enfBundle.created_at,
            status: enfBundle.status,
        };

        // Validate expected type/id if provided
        if (expectedType && expectedType !== 'ENF_BUNDLE') {
            result.warnings = result.warnings || [];
            result.warnings.push(`Expected type ${expectedType} but found ENF_BUNDLE`);
        }
        if (expectedId && expectedId !== enfBundle.id) {
            result.warnings = result.warnings || [];
            result.warnings.push(`Expected ID ${expectedId} but found ${enfBundle.id}`);
        }

        // Check expiry
        if (enfBundle.expires_at && enfBundle.expires_at < Date.now()) {
            result.status = 'EXPIRED';
            result.message = 'Document found but has expired';
            return result;
        }

        // Look for attestation record for blockchain proof
        const attestation = await findAttestationByHash(env, enfBundle.evidence_hash);
        if (attestation) {
            return await enrichWithBlockchainData(env, result, attestation);
        }

        // ENF found but not anchored to blockchain
        result.status = 'VERIFIED';
        result.verified = true;
        result.message = 'Document verified (not yet anchored to blockchain)';
        return result;
    }

    // Try to find attestation record directly
    const attestation = await findAttestationByHash(env, normalizedHash);
    if (attestation) {
        result.source = {
            type: 'ATTESTATION',
            id: attestation.id,
            created_at: attestation.receivedAt,
            status: attestation.mode,
        };

        return await enrichWithBlockchainData(env, result, attestation);
    }

    return result;
}

/**
 * Enrich verification result with blockchain data.
 */
async function enrichWithBlockchainData(
    env: Env,
    result: VerificationResult,
    attestation: AttestRecord
): Promise<VerificationResult> {
    // Get blockchain details
    const blockchain = await getBlockchainDetails(env, attestation);
    if (blockchain) {
        result.blockchain = blockchain;

        // Parse and verify Merkle proof
        const merkleDetails = parseMerkleProof(attestation);
        if (merkleDetails) {
            // Verify the Merkle proof
            const proofInput: MerkleProof = {
                leaf: merkleDetails.leaf_hash,
                root: merkleDetails.merkle_root,
                proof: merkleDetails.proof_path,
                index: merkleDetails.leaf_index,
            };

            try {
                merkleDetails.proof_valid = await verifyMerkleProof(proofInput);
            } catch {
                merkleDetails.proof_valid = false;
            }

            result.merkle_proof = merkleDetails;
        }

        // Determine status based on blockchain confirmation
        switch (blockchain.status) {
            case 'CONFIRMED':
                if (blockchain.confirmations >= blockchain.required_confirmations) {
                    result.status = 'VERIFIED';
                    result.verified = true;
                    result.message = `Document verified with ${blockchain.confirmations} blockchain confirmations`;
                } else {
                    result.status = 'PENDING';
                    result.verified = false;
                    result.message = `Awaiting confirmations (${blockchain.confirmations}/${blockchain.required_confirmations})`;
                }
                break;

            case 'PENDING':
                result.status = 'PENDING';
                result.verified = false;
                result.message = 'Transaction submitted, awaiting blockchain confirmation';
                break;

            case 'FAILED':
                result.status = 'INVALID';
                result.verified = false;
                result.message = 'Blockchain transaction failed';
                break;

            case 'REORGED':
                result.status = 'INVALID';
                result.verified = false;
                result.message = 'Blockchain reorganization detected - verification unreliable';
                result.warnings = result.warnings || [];
                result.warnings.push('Transaction was affected by a chain reorganization');
                break;

            default:
                result.status = 'VERIFIED';
                result.verified = true;
                result.message = 'Document verified (blockchain status unknown)';
        }
    } else {
        // No blockchain anchor
        if (attestation.mode === 'anchored') {
            result.status = 'INVALID';
            result.verified = false;
            result.message = 'Record marked as anchored but blockchain data unavailable';
        } else if (attestation.mode === 'pending' || attestation.mode === 'confirmed') {
            result.status = 'PENDING';
            result.verified = false;
            result.message = 'Document recorded, awaiting blockchain anchoring';
        } else {
            result.status = 'VERIFIED';
            result.verified = true;
            result.message = 'Document verified in system (not anchored to blockchain)';
        }
    }

    return result;
}

/**
 * Verify by target entity (ENF bundle or challenge).
 */
export async function verifyByTarget(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE' | 'ATTESTATION',
    targetId: string
): Promise<VerificationResult> {
    const verifiedAt = new Date().toISOString();

    const result: VerificationResult = {
        status: 'NOT_FOUND',
        verified: false,
        message: `${targetType} not found`,
        verified_at: verifiedAt,
        document_hash: '',
        hash_algorithm: 'SHA-256',
    };

    if (targetType === 'ENF_BUNDLE') {
        const bundle = await findEnfBundleById(env, targetId);
        if (!bundle) {
            return result;
        }

        result.document_hash = bundle.evidence_hash;
        result.source = {
            type: 'ENF_BUNDLE',
            id: bundle.id,
            title: bundle.title,
            created_at: bundle.created_at,
            status: bundle.status,
        };

        // Check expiry
        if (bundle.expires_at && bundle.expires_at < Date.now()) {
            result.status = 'EXPIRED';
            result.message = 'ENF bundle has expired';
            return result;
        }

        // Look for attestation
        const attestation = await findAttestationByHash(env, bundle.evidence_hash);
        if (attestation) {
            return await enrichWithBlockchainData(env, result, attestation);
        }

        result.status = 'VERIFIED';
        result.verified = true;
        result.message = 'ENF bundle verified (not yet anchored)';
        return result;
    }

    if (targetType === 'ATTESTATION') {
        const attestation = await getReceipt(env, targetId);
        if (!attestation) {
            return result;
        }

        result.document_hash = attestation.initiatorCommit;
        result.source = {
            type: 'ATTESTATION',
            id: attestation.id,
            created_at: attestation.receivedAt,
            status: attestation.mode,
        };

        return await enrichWithBlockchainData(env, result, attestation);
    }

    // CHALLENGE type - would need to implement challenge lookup
    return result;
}

/**
 * Quick verification check (simpler response).
 */
export async function quickVerify(
    env: Env,
    hash: string
): Promise<QuickVerificationResult> {
    const fullResult = await verifyByHash(env, hash);

    return {
        verified: fullResult.verified,
        status: fullResult.status,
        message: fullResult.message,
        blockchain_confirmed: fullResult.blockchain?.status === 'CONFIRMED',
        confirmations: fullResult.blockchain?.confirmations,
    };
}

/**
 * Verify a Merkle proof directly.
 */
export async function verifyProof(
    input: VerifyMerkleProofInput
): Promise<{ valid: boolean; message: string }> {
    const proof: MerkleProof = {
        leaf: input.leaf,
        root: input.root,
        proof: input.proof,
        index: input.index,
    };

    try {
        const valid = await verifyMerkleProof(proof);
        return {
            valid,
            message: valid
                ? 'Merkle proof is valid'
                : 'Merkle proof is invalid - hash does not match root',
        };
    } catch (error) {
        return {
            valid: false,
            message: `Proof verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Get verification stats for monitoring.
 */
export async function getVerificationStats(
    env: Env
): Promise<{
    total_bundles: number;
    anchored_bundles: number;
    pending_bundles: number;
}> {
    const bundles = await query<{ status: string; count: number }>(
        env.TATTLEHASH_DB,
        `SELECT status, COUNT(*) as count FROM enf_bundles GROUP BY status`
    );

    let total = 0;
    let anchored = 0;
    let pending = 0;

    for (const row of bundles) {
        total += row.count;
        if (row.status === 'COMPLETE') {
            anchored += row.count;
        } else if (row.status === 'SENT' || row.status === 'PARTIAL') {
            pending += row.count;
        }
    }

    return {
        total_bundles: total,
        anchored_bundles: anchored,
        pending_bundles: pending,
    };
}
