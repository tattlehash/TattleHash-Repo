import type { RiskLevel, TrustFlag } from '../trust-score';

/**
 * Trust Score summary included in Gatekeeper responses
 */
export interface TrustScoreSummary {
    score: number;
    riskLevel: RiskLevel;
    flags: TrustFlag[];
    confidence: number;
    lastUpdated: string;
}

/**
 * Traffic light state for wallet verification
 */
export type WalletTrafficLight = 'GREEN' | 'YELLOW' | 'RED';

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
    user_id: string;
    token: string;
    token_expires_at: string;
    /** Trust Score assessment for verified wallet */
    trust_score: TrustScoreSummary;
    /** Traffic light based on Trust Score + verification status */
    traffic_light: WalletTrafficLight;
    /** Recommendation based on traffic light */
    recommendation: string;
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
