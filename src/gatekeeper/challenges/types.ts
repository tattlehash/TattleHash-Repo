
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
}

export interface AcceptChallengeInput {
    // Future: acceptance message, etc.
}

export interface VerificationResult {
    allPassed: boolean;
    creatorWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
    creatorFunds: 'PENDING' | 'PASSED' | 'FAILED';
    counterpartyWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
    counterpartyFunds: 'PENDING' | 'PASSED' | 'FAILED';
    failures: string[];
}
