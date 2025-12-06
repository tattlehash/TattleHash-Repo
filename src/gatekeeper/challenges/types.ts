import type { FeeArrangement, CoinSide } from '../../coin-toss';

export type ChallengeStatus =
    | 'DRAFT'
    | 'AWAITING_COUNTERPARTY'
    | 'AWAITING_GATEKEEPER'
    | 'INTENT_LOCKED'
    | 'AWAITING_RESOLUTION'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'DISPUTED';

export type ChallengeMode = 'SOLO' | 'GATEKEEPER' | 'FIRE' | 'ENFORCED';

// Re-export for convenience
export type { FeeArrangement, CoinSide };

export interface Challenge {
    id: string;
    mode: ChallengeMode;
    creator_user_id: string;
    counterparty_user_id?: string;
    /** Counterparty email for Fire mode notifications */
    counterparty_email?: string;
    /** Custom note from initiator to counterparty */
    custom_note?: string;
    title: string;
    description?: string;
    /** SHA-256 hash of the uploaded evidence document */
    content_hash?: string;
    /** Original filename of uploaded document (for display only) */
    file_name?: string;
    /** File size in bytes */
    file_size?: number;
    status: ChallengeStatus;
    expires_at?: string;
    intent_locked_at?: number;
    resolved_at?: number;
    created_at: number;
    updated_at: number;
    /** Fee arrangement for Gatekeeper/Enforced modes */
    fee_arrangement?: FeeArrangement;
    /** Link to attestation receipt in KV storage */
    receipt_id?: string;
    /** Blockchain transaction hash once anchored */
    anchor_tx_hash?: string;
    /** Block number where anchoring was confirmed */
    anchor_block_number?: number;
}

export interface GatekeeperRequirement {
    wallet_address: string;
    network: string;
    funds_checks?: Array<{
        asset_type: 'NATIVE' | 'ERC20';
        token_address?: string;
        min_balance: string;
        currency_symbol: string;
    }>;
}

export interface CreateChallengeInput {
    mode: ChallengeMode;
    title: string;
    description?: string;
    /** SHA-256 hash of the evidence document (computed client-side) */
    content_hash?: string;
    /** Original filename for display purposes */
    file_name?: string;
    /** File size in bytes */
    file_size?: number;
    counterparty_user_id?: string;
    /** Counterparty email for notification (Fire mode) */
    counterparty_email?: string;
    /** Custom note from initiator to counterparty */
    custom_note?: string;
    expires_at?: string;
    gatekeeper_requirements?: {
        creator?: GatekeeperRequirement;
        counterparty?: GatekeeperRequirement;
    };
    /** Fee arrangement for Gatekeeper/Enforced modes. Defaults to 'creator_pays'. */
    fee_arrangement?: FeeArrangement;
    /** If fee_arrangement is 'coin_toss', the creator's call (heads or tails) */
    coin_toss_call?: CoinSide;
}

export interface AcceptChallengeInput {
    // Future: acceptance message, etc.
}

/**
 * Trust Score attestation data included in verification results
 */
export interface TrustScoreAttestation {
    wallet: string;
    score: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    trafficLight: 'GREEN' | 'YELLOW' | 'RED';
    flagCount: number;
    confidence: number;
    assessedAt: string;
}

export interface VerificationResult {
    allPassed: boolean;
    creatorWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
    creatorFunds: 'PENDING' | 'PASSED' | 'FAILED';
    counterpartyWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
    counterpartyFunds: 'PENDING' | 'PASSED' | 'FAILED';
    failures: string[];
    /** Trust Score attestation metadata for both parties */
    trustScores?: {
        creator?: TrustScoreAttestation;
        counterparty?: TrustScoreAttestation;
    };
}
