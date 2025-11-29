
export interface WalletChallengeRequest {
    wallet_address: string;
    chain_id: string;
    user_id?: string;
}

export interface WalletChallengeResponse {
    challenge_id: string;
    message: string;
    expires_at: string;
}

export interface WalletVerifyRequest {
    challenge_id: string;
    signature: string;
}

export interface WalletVerifyResponse {
    status: 'VERIFIED';
    wallet_address: string;
    verified_at: string;
}

export interface WalletVerificationChallenge {
    id: string;
    user_id?: string;
    wallet_address: string;
    chain_id: string;
    challenge_nonce: string;
    message: string;
    method: string;
    status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'FAILED';
    created_at: string;
    expires_at: string;
    verified_at?: string;
    last_error?: string;
}
