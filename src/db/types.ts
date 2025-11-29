// Database row types matching D1 schema (002_complete_schema.sql + 003_add_awaiting_gatekeeper.sql)

export interface User {
    id: string;
    wallet_address: string;
    created_at: number;
    updated_at: number;
}

/** @deprecated Use Challenge from src/gatekeeper/challenges/types.ts instead */
export type ChallengeStatus =
    | 'DRAFT'
    | 'AWAITING_COUNTERPARTY'
    | 'AWAITING_GATEKEEPER'
    | 'INTENT_LOCKED'
    | 'AWAITING_RESOLUTION'
    | 'DISPUTED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'EXPIRED';

/** @deprecated Use Challenge from src/gatekeeper/challenges/types.ts instead */
export type ChallengeMode = 'SOLO' | 'GATEKEEPER' | 'FIRE' | 'ENFORCED';

/**
 * Challenge row type matching D1 schema.
 * @deprecated Prefer using Challenge from src/gatekeeper/challenges/types.ts
 *             This type is kept for backwards compatibility with existing code.
 */
export interface Challenge {
    id: string;
    mode: ChallengeMode;
    creator_user_id: string;
    counterparty_user_id?: string;
    title?: string;
    description?: string;
    status: ChallengeStatus;
    created_at: number;
    updated_at: number;
    expires_at?: string;
    intent_locked_at?: number;
    resolved_at?: number;
}

export interface WalletChallenge {
    id: string;
    wallet_address: string;
    nonce: string;
    chain_id: string;
    created_at: number;
    expires_at: number;
    used_at?: number;
}

export interface Webhook {
    id: string;
    user_id: string;
    url: string;
    secret: string;
    events: string; // JSON array of event types
    created_at: number;
    active: number; // boolean 0/1
}

export interface WebhookDelivery {
    id: string;
    subscription_id: string;
    event_type: string;
    payload: string; // JSON
    status: 'PENDING' | 'DELIVERED' | 'FAILED';
    attempts: number;
    last_attempt_at?: number;
    delivered_at?: number;
    created_at: number;
}

export interface ChallengeDispute {
    id: string;
    challenge_id: string;
    raised_by_user_id: string;
    reason: string;
    evidence?: string; // JSON
    status: 'PENDING' | 'RESOLVED';
    winner_user_id?: string;
    resolution?: string;
    resolved_at?: number;
    created_at: number;
}

export interface FundsRequirement {
    id: string;
    challenge_id: string;
    user_id: string;
    wallet_address: string;
    network: string;
    asset_type: 'NATIVE' | 'ERC20';
    token_address?: string;
    min_balance: string;
    currency_symbol: string;
    snapshot_policy: 'AT_CREATION' | 'AT_INTENT_LOCK' | 'AT_COMPLETION';
}

export interface BondDeposit {
    id: string;
    challenge_id: string;
    user_id: string;
    amount: string;
    currency_code: string;
    tx_hash?: string;
    deposited_at: number;
    status: 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'FORFEITED';
}
