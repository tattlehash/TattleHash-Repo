/**
 * Verification Portal Types and Schemas
 *
 * Types for document and evidence verification.
 */

import { z } from 'zod';

// ============================================================================
// Verification Status
// ============================================================================

/**
 * Overall verification status.
 */
export type VerificationStatus =
    | 'VERIFIED'           // Hash found and blockchain confirmed
    | 'PENDING'            // Hash found but blockchain not yet confirmed
    | 'NOT_FOUND'          // Hash not found in system
    | 'INVALID'            // Hash found but verification failed
    | 'EXPIRED';           // Record found but has expired

/**
 * Blockchain confirmation status.
 */
export type BlockchainStatus =
    | 'CONFIRMED'          // Transaction confirmed on chain
    | 'PENDING'            // Transaction submitted, awaiting confirmation
    | 'NOT_ANCHORED'       // Not yet submitted to blockchain
    | 'FAILED'             // Transaction failed
    | 'REORGED';           // Transaction was reorged (rare)

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Verify by document hash.
 */
export const VerifyByHashSchema = z.object({
    /** SHA-256 hash of the document content */
    hash: z.string().min(32).max(128),
    /** Optional: expected target type for additional validation */
    target_type: z.enum(['ENF_BUNDLE', 'CHALLENGE', 'ATTESTATION']).optional(),
    /** Optional: expected target ID for additional validation */
    target_id: z.string().uuid().optional(),
});

export type VerifyByHashInput = z.infer<typeof VerifyByHashSchema>;

/**
 * Verify by target entity.
 */
export const VerifyByTargetSchema = z.object({
    /** Target entity type */
    target_type: z.enum(['ENF_BUNDLE', 'CHALLENGE', 'ATTESTATION']),
    /** Target entity ID */
    target_id: z.string().uuid(),
});

export type VerifyByTargetInput = z.infer<typeof VerifyByTargetSchema>;

/**
 * Verify Merkle proof.
 */
export const VerifyMerkleProofSchema = z.object({
    /** Leaf hash (the document/evidence hash) */
    leaf: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    /** Merkle root (anchored on blockchain) */
    root: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    /** Proof path (sibling hashes) */
    proof: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),
    /** Leaf index in the tree */
    index: z.number().int().min(0),
});

export type VerifyMerkleProofInput = z.infer<typeof VerifyMerkleProofSchema>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Blockchain anchor details.
 */
export interface BlockchainAnchorDetails {
    chain: string;
    chain_name: string;
    chain_id: number;
    tx_hash: string;
    block_number?: number;
    block_hash?: string;
    timestamp?: number;
    confirmations: number;
    required_confirmations: number;
    explorer_url: string;
    status: BlockchainStatus;
}

/**
 * Merkle proof details.
 */
export interface MerkleProofDetails {
    leaf_hash: string;
    merkle_root: string;
    proof_path: string[];
    leaf_index: number;
    proof_valid: boolean;
}

/**
 * Source document details.
 */
export interface SourceDocumentDetails {
    type: 'ENF_BUNDLE' | 'CHALLENGE' | 'ATTESTATION' | 'DOSSIER';
    id: string;
    title?: string;
    created_at: number;
    status?: string;
}

/**
 * Full verification result.
 */
export interface VerificationResult {
    /** Overall verification status */
    status: VerificationStatus;
    /** Whether the document is verified */
    verified: boolean;
    /** Human-readable status message */
    message: string;
    /** Timestamp of verification check */
    verified_at: string;

    /** Document hash that was verified */
    document_hash: string;
    /** Hash algorithm used */
    hash_algorithm: 'SHA-256';

    /** Source document details (if found) */
    source?: SourceDocumentDetails;

    /** Blockchain anchor details (if anchored) */
    blockchain?: BlockchainAnchorDetails;

    /** Merkle proof details (if available) */
    merkle_proof?: MerkleProofDetails;

    /** Warnings or additional information */
    warnings?: string[];
}

/**
 * Simple verification check result.
 */
export interface QuickVerificationResult {
    verified: boolean;
    status: VerificationStatus;
    message: string;
    blockchain_confirmed: boolean;
    confirmations?: number;
}

// ============================================================================
// Chain Configuration
// ============================================================================

export const CHAIN_EXPLORER_URLS: Record<string, string> = {
    polygon: 'https://polygonscan.com',
    ethereum: 'https://etherscan.io',
    base: 'https://basescan.org',
    arbitrum: 'https://arbiscan.io',
    optimism: 'https://optimistic.etherscan.io',
};

export const CHAIN_NAMES: Record<string, string> = {
    polygon: 'Polygon PoS',
    ethereum: 'Ethereum Mainnet',
    base: 'Base',
    arbitrum: 'Arbitrum One',
    optimism: 'Optimism',
};

export const CHAIN_IDS: Record<string, number> = {
    polygon: 137,
    ethereum: 1,
    base: 8453,
    arbitrum: 42161,
    optimism: 10,
};
