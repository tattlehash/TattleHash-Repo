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
    title: string;
    description?: string;
    status: ChallengeStatus;
    expires_at?: string;
    intent_locked_at?: number;
    resolved_at?: number;
    created_at: number;
    updated_at: number;
    /** Fee arrangement for Gatekeeper/Enforced modes */
    fee_arrangement?: FeeArrangement;
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
    counterparty_user_id?: string;
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
