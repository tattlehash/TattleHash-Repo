/**
 * Stakes Module Types
 *
 * Full escrow system for ENFORCED mode transactions.
 * Supports multi-chain deposits, threshold verification, and automatic slashing.
 */

import { z } from 'zod';

// ============================================================================
// Beta Limits - must be defined before schemas that reference them
// ============================================================================

export const BETA_LIMITS = {
    MAX_TRANSACTION_USD: 1000,          // $1,000 max per enforced transaction
    MAX_CREDITS_PER_PURCHASE: 25,       // 25 credits max per purchase
    MAX_ATTESTATIONS_PER_DAY: 10,       // 10 attestations per user per day
} as const;

// ============================================================================
// Stake Status
// ============================================================================

export type StakeStatus =
    | 'PENDING'      // Awaiting deposit confirmation
    | 'CONFIRMED'    // Deposit confirmed on-chain
    | 'HELD'         // In escrow, locked
    | 'RELEASED'     // Released to original depositor
    | 'TRANSFERRED'  // Transferred to counterparty (dispute resolution)
    | 'SLASHED';     // Forfeited due to violation

export type StakeEventType =
    | 'DEPOSIT_INITIATED'
    | 'DEPOSIT_CONFIRMED'
    | 'LOCKED'
    | 'RELEASE_INITIATED'
    | 'RELEASED'
    | 'TRANSFER_INITIATED'
    | 'TRANSFERRED'
    | 'SLASH_INITIATED'
    | 'SLASHED';

// ============================================================================
// Traffic Light States
// ============================================================================

export type TrafficLightState = 'GREEN' | 'YELLOW' | 'RED';

export interface PartyTrustScoreSummary {
    wallet: string;
    score: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    hasCriticalFlags: boolean;
    confidence: number;
}

export interface TrafficLightEvaluation {
    state: TrafficLightState;
    reason: string;
    details: {
        creatorStake: StakeVerification;
        counterpartyStake: StakeVerification;
        thresholdsMet: boolean;
        timeRemaining: number | null;  // seconds, null if no deadline
        flags: string[];
        /** Trust Score assessment for both parties */
        trustScores?: {
            creator: PartyTrustScoreSummary | null;
            counterparty: PartyTrustScoreSummary | null;
        };
    };
    evaluatedAt: number;
}

export interface StakeVerification {
    status: 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'INSUFFICIENT' | 'FAILED';
    required: string;
    deposited: string;
    confirmations: number;
    requiredConfirmations: number;
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface Stake {
    id: string;
    challenge_id: string;
    user_id: string;
    wallet_address: string;
    amount: string;
    currency_code: string;
    chain_id: string;
    token_address: string | null;
    deposit_tx_hash: string | null;
    release_tx_hash: string | null;
    status: StakeStatus;
    deposited_at: number | null;
    confirmed_at: number | null;
    released_at: number | null;
    created_at: number;
    updated_at: number;
}

export interface EnforcedThreshold {
    id: string;
    challenge_id: string;
    min_usd_value: string;
    max_usd_value: string | null;
    required_confirmations: number;
    allowed_chains: string;   // JSON array
    allowed_assets: string;   // JSON array
    deal_expiry_at: string | null;
    creator_stake_required: string;
    counterparty_stake_required: string;
    stake_currency: string;
    created_at: number;
}

export interface TrafficLightRecord {
    id: string;
    challenge_id: string;
    state: TrafficLightState;
    reason: string;
    details: string | null;  // JSON
    evaluated_at: number;
}

export interface StakeEvent {
    id: string;
    stake_id: string;
    event_type: StakeEventType;
    tx_hash: string | null;
    details: string | null;  // JSON
    created_at: number;
}

// ============================================================================
// API Input/Output Types
// ============================================================================

export interface CreateEnforcedChallengeInput {
    title: string;
    description?: string;
    counterparty_user_id: string;

    // Timeout configuration (per ADR-006)
    accept_timeout_seconds?: number;    // Default: 900 (15 min)
    response_timeout_seconds?: number;  // Default: 86400 (24 hours)
    dispute_timeout_seconds?: number;   // Default: 259200 (72 hours)

    // Threshold configuration
    thresholds: {
        min_usd_value: string;
        max_usd_value?: string;
        required_confirmations?: number;    // Default: 12
        allowed_chains: string[];           // e.g., ["eip155:1", "eip155:137"]
        allowed_assets: string[];           // e.g., ["ETH", "USDC"]
        deal_expiry_at?: string;           // ISO timestamp
    };

    // Stake configuration
    stakes: {
        creator_stake: string;              // Amount in stake_currency
        counterparty_stake: string;
        stake_currency: string;             // e.g., "USDC"
    };
}

export interface DepositStakeInput {
    challenge_id: string;
    wallet_address: string;
    chain_id: string;
    token_address?: string;
    tx_hash: string;
}

export interface ReleaseStakeInput {
    challenge_id: string;
    stake_id: string;
    release_to: 'DEPOSITOR' | 'COUNTERPARTY';
    reason: string;
}

export interface StakeResult {
    stake: Stake;
    trafficLight: TrafficLightEvaluation;
}

export interface EnforcedChallengeStatus {
    challenge_id: string;
    status: string;
    trafficLight: TrafficLightEvaluation;
    stakes: {
        creator: Stake | null;
        counterparty: Stake | null;
    };
    thresholds: {
        min_usd_value: string;
        max_usd_value: string | null;
        required_confirmations: number;
        allowed_chains: string[];
        allowed_assets: string[];
        deal_expiry_at: string | null;
    };
    timeouts: {
        accept_deadline: string | null;
        response_deadline: string | null;
        dispute_deadline: string | null;
    };
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const CreateEnforcedChallengeSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    counterparty_user_id: z.string().uuid(),

    accept_timeout_seconds: z.number().int().min(60).max(604800).default(900),
    response_timeout_seconds: z.number().int().min(300).max(2592000).default(86400),
    dispute_timeout_seconds: z.number().int().min(3600).max(2592000).default(259200),

    thresholds: z.object({
        min_usd_value: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid USD format'),
        max_usd_value: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        required_confirmations: z.number().int().min(1).max(100).default(12),
        allowed_chains: z.array(z.string()).min(1),
        allowed_assets: z.array(z.string()).min(1),
        deal_expiry_at: z.string().datetime().optional(),
    }),

    stakes: z.object({
        creator_stake: z.string().regex(/^\d+(\.\d+)?$/),
        counterparty_stake: z.string().regex(/^\d+(\.\d+)?$/),
        stake_currency: z.string().min(1).max(10),
    }),
}).refine(
    (data) => {
        const minValue = parseFloat(data.thresholds.min_usd_value);
        const maxValue = data.thresholds.max_usd_value ? parseFloat(data.thresholds.max_usd_value) : minValue;
        // Beta limit: max $1,000 per transaction
        return minValue <= BETA_LIMITS.MAX_TRANSACTION_USD && maxValue <= BETA_LIMITS.MAX_TRANSACTION_USD;
    },
    {
        message: `Beta limit: Transaction value cannot exceed $${BETA_LIMITS.MAX_TRANSACTION_USD.toLocaleString()}`,
        path: ['thresholds', 'min_usd_value'],
    }
);

export const DepositStakeSchema = z.object({
    challenge_id: z.string().uuid(),
    wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    chain_id: z.string().regex(/^eip155:\d+$/),
    token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const ReleaseStakeSchema = z.object({
    challenge_id: z.string().uuid(),
    stake_id: z.string().uuid(),
    release_to: z.enum(['DEPOSITOR', 'COUNTERPARTY']),
    reason: z.string().min(1).max(500),
});

// ============================================================================
// Constants
// ============================================================================

export const ENFORCED_DEFAULTS = {
    ACCEPT_TIMEOUT_SECONDS: 900,        // 15 minutes
    RESPONSE_TIMEOUT_SECONDS: 86400,    // 24 hours
    DISPUTE_TIMEOUT_SECONDS: 259200,    // 72 hours
    REQUIRED_CONFIRMATIONS: 12,
} as const;

export const TIMEOUT_CONSTRAINTS = {
    ACCEPT: { min: 60, max: 604800 },           // 1 min to 7 days
    RESPONSE: { min: 300, max: 2592000 },       // 5 min to 30 days
    DISPUTE: { min: 3600, max: 2592000 },       // 1 hour to 30 days
} as const;
