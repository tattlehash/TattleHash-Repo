/**
 * Verification Portal Module
 *
 * Document and evidence verification against blockchain anchors.
 */

// Types
export type {
    VerificationStatus,
    BlockchainStatus,
    VerifyByHashInput,
    VerifyByTargetInput,
    VerifyMerkleProofInput,
    BlockchainAnchorDetails,
    MerkleProofDetails,
    SourceDocumentDetails,
    VerificationResult,
    QuickVerificationResult,
} from './types';

export {
    VerifyByHashSchema,
    VerifyByTargetSchema,
    VerifyMerkleProofSchema,
    CHAIN_EXPLORER_URLS,
    CHAIN_NAMES,
    CHAIN_IDS,
} from './types';

// Service
export {
    verifyByHash,
    verifyByTarget,
    quickVerify,
    verifyProof,
    getVerificationStats,
} from './service';
