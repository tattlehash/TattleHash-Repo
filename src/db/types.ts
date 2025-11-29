
export interface User {
    id: string;
    wallet_address: string;
    created_at: number;
    updated_at: number;
}

export interface Challenge {
    id: string;
    creator_wallet: string;
    counterparty_wallet?: string;
    status: 'DRAFT' | 'INTENT_LOCKED' | 'COMPLETED' | 'CANCELLED';
    mode: 'SOLO' | 'GATEKEEPER' | 'FIRE' | 'ENFORCED';
    created_at: number;
    updated_at: number;
    expires_at?: number;
    metadata?: string; // JSON string
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
