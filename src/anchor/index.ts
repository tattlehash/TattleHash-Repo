/**
 * Anchor module exports.
 *
 * Provides blockchain anchoring with:
 * - Merkle tree batching
 * - Multi-chain support (Polygon first)
 * - Mock/Relay/Direct modes
 */

// Storage types and functions
export {
    type ModeState,
    type AnchorJob,
    type AttestRecord,
    JOB_TTL_SEC,
    enqueueAnchor,
    listAnchorJobs,
    getJob,
    deleteJob,
    getReceipt,
    putReceipt,
    makeReceipt,
} from './storage';

// Merkle tree
export {
    buildMerkleTree,
    verifyMerkleProof,
    createLeafData,
    type MerkleTree,
    type MerkleProof,
} from './merkle';

// Chain providers
export {
    createChainProvider,
    createPolygonProvider,
    PolygonProvider,
    CHAIN_CONFIGS,
    type ChainProvider,
    type ChainConfig,
    type ChainId,
    type TransactionResult,
    type TransactionStatus,
    type AnchorTransaction,
} from './chains';

// Anchor service
export {
    anchorRecord,
    anchorBatch,
    queryTransactionStatus,
    processPendingAnchors,
    type AnchorBatchResult,
} from './service';
