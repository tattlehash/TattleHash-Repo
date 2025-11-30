/**
 * Trust Score Types and Schemas
 *
 * Real-time risk assessment for wallet addresses.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const TRUST_SCORE_DEFAULTS = {
    CACHE_TTL_SECONDS: 3600, // 1 hour
    MAX_BATCH_SIZE: 100,
    HISTORY_LIMIT: 100,
};

/**
 * Risk level thresholds - maps score to risk level
 * LOW: 70-100 (Green light)
 * MEDIUM: 40-69 (Yellow light)
 * HIGH: 0-39 (Red light)
 */
export const RISK_THRESHOLDS = {
    LOW_MIN: 70,
    MEDIUM_MIN: 40,
    // HIGH: 0-39
} as const;

/**
 * Scoring factor weights - must sum to 1.0
 */
export const FACTOR_WEIGHTS = {
    walletAge: 0.20,
    transactionHistory: 0.25,
    disputeRate: 0.30,
    verificationStatus: 0.15,
    networkAnalysis: 0.10,
} as const;

/**
 * Flag types with their default severity and impact on score
 */
export const FLAG_DEFINITIONS = {
    WALLET_NEW: {
        severity: 'WARNING' as const,
        description: 'Wallet is less than 7 days old',
        scoreImpact: -10,
    },
    LIMITED_HISTORY: {
        severity: 'INFO' as const,
        description: 'Fewer than 3 transactions on record',
        scoreImpact: -5,
    },
    DISPUTE_HISTORY: {
        severity: 'WARNING' as const,
        description: 'Has disputed transactions',
        scoreImpact: -15,
    },
    VERIFICATION_FAILED: {
        severity: 'CRITICAL' as const,
        description: 'Failed Gatekeeper verification',
        scoreImpact: -25,
    },
    FLAGGED_CONNECTIONS: {
        severity: 'WARNING' as const,
        description: 'Transacted with known flagged wallets',
        scoreImpact: -20,
    },
    PATTERN_ANOMALY: {
        severity: 'WARNING' as const,
        description: 'Unusual transaction patterns detected',
        scoreImpact: -15,
    },
    SCAM_REPORT: {
        severity: 'CRITICAL' as const,
        description: 'Reported for scam activity',
        scoreImpact: -30,
    },
    MANUAL_FLAG: {
        severity: 'INFO' as const,
        description: 'Manually flagged by admin',
        scoreImpact: -10,
    },
} as const;

// ============================================================================
// Zod Schemas
// ============================================================================

export const WalletAddressSchema = z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum wallet address');

export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const FlagTypeSchema = z.enum([
    'WALLET_NEW',
    'LIMITED_HISTORY',
    'DISPUTE_HISTORY',
    'VERIFICATION_FAILED',
    'FLAGGED_CONNECTIONS',
    'PATTERN_ANOMALY',
    'SCAM_REPORT',
    'MANUAL_FLAG',
]);

export const FlagSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);

export const TriggerReasonSchema = z.enum([
    'INITIAL',
    'SCHEDULED',
    'TRANSACTION',
    'DISPUTE',
    'VERIFICATION',
    'MANUAL',
    'FLAG_CHANGE',
    'CACHE_EXPIRED',
]);

// ============================================================================
// Factor Schemas
// ============================================================================

export const ScoreFactorSchema = z.object({
    value: z.string(),
    score: z.number().min(0).max(100),
    weight: z.number().min(0).max(1),
    detail: z.string(),
});

export const ScoreFactorsSchema = z.object({
    walletAge: ScoreFactorSchema,
    transactionHistory: ScoreFactorSchema,
    disputeRate: ScoreFactorSchema,
    verificationStatus: ScoreFactorSchema,
    networkAnalysis: ScoreFactorSchema,
});

// ============================================================================
// Flag Schema
// ============================================================================

export const TrustFlagSchema = z.object({
    type: FlagTypeSchema,
    severity: FlagSeveritySchema,
    description: z.string(),
    detectedAt: z.string().datetime(),
    evidence: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Response Schemas
// ============================================================================

export const TrustScoreResponseSchema = z.object({
    wallet: z.string(),
    trustScore: z.number().min(0).max(100),
    riskLevel: RiskLevelSchema,
    factors: ScoreFactorsSchema,
    flags: z.array(TrustFlagSchema),
    confidence: z.number().min(0).max(1),
    lastUpdated: z.string().datetime(),
    cacheTTL: z.number(),
});

export const TrustScoreHistoryItemSchema = z.object({
    trustScore: z.number(),
    riskLevel: RiskLevelSchema,
    confidence: z.number(),
    calculatedAt: z.string().datetime(),
    triggerReason: TriggerReasonSchema,
});

export const TrustScoreHistoryResponseSchema = z.object({
    wallet: z.string(),
    currentScore: z.number(),
    history: z.array(TrustScoreHistoryItemSchema),
    trend: z.enum(['IMPROVING', 'STABLE', 'DECLINING']),
    oldestRecord: z.string().datetime().optional(),
    newestRecord: z.string().datetime().optional(),
});

export const BatchTrustScoreRequestSchema = z.object({
    wallets: z.array(WalletAddressSchema).min(1).max(TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE),
    skipCache: z.boolean().optional().default(false),
});

export const BatchTrustScoreResponseSchema = z.object({
    results: z.array(TrustScoreResponseSchema),
    errors: z.array(z.object({
        wallet: z.string(),
        error: z.string(),
    })),
    cached: z.number(),
    calculated: z.number(),
});

// ============================================================================
// Request Schemas
// ============================================================================

export const GetTrustScoreParamsSchema = z.object({
    skipCache: z.boolean().optional().default(false),
});

export const GetHistoryParamsSchema = z.object({
    limit: z.number().min(1).max(TRUST_SCORE_DEFAULTS.HISTORY_LIMIT).optional().default(50),
    since: z.string().datetime().optional(),
});

// ============================================================================
// Database Types
// ============================================================================

export interface TrustScoreRecord {
    id: string;
    wallet_address: string;
    wallet_address_lower: string;
    trust_score: number;
    risk_level: RiskLevel;
    confidence: number;
    factors: string; // JSON
    flags: string | null; // JSON
    data_points_available: number;
    data_points_total: number;
    cache_ttl: number;
    expires_at: number;
    first_seen_at: number;
    last_updated_at: number;
    last_calculated_at: number;
}

export interface TrustScoreHistoryRecord {
    id: string;
    wallet_address: string;
    trust_score_id: string;
    trust_score: number;
    risk_level: RiskLevel;
    confidence: number;
    factors: string;
    flags: string | null;
    trigger_reason: TriggerReason;
    calculated_at: number;
}

export interface WalletFlagRecord {
    id: string;
    wallet_address: string;
    wallet_address_lower: string;
    flag_type: FlagType;
    severity: FlagSeverity;
    description: string;
    evidence: string | null;
    source: 'SYSTEM' | 'USER_REPORT' | 'LLM_ANALYSIS' | 'EXTERNAL' | 'ADMIN';
    reported_by_user_id: string | null;
    active: number;
    resolved_at: number | null;
    resolved_by_user_id: string | null;
    resolution_notes: string | null;
    created_at: number;
    updated_at: number;
}

export interface WalletStatsRecord {
    wallet_address: string;
    wallet_address_lower: string;
    total_transactions: number;
    total_challenges_created: number;
    total_challenges_received: number;
    total_enf_bundles_sent: number;
    total_enf_bundles_received: number;
    disputes_raised: number;
    disputes_received: number;
    disputes_won: number;
    disputes_lost: number;
    gatekeeper_verifications: number;
    last_verification_status: 'PASSED' | 'FAILED' | 'PENDING' | null;
    last_verification_at: number | null;
    unique_counterparties: number;
    flagged_counterparty_count: number;
    first_seen_at: number;
    last_active_at: number;
    stats_updated_at: number;
}

// ============================================================================
// Type Exports
// ============================================================================

export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type FlagType = z.infer<typeof FlagTypeSchema>;
export type FlagSeverity = z.infer<typeof FlagSeveritySchema>;
export type TriggerReason = z.infer<typeof TriggerReasonSchema>;
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;
export type ScoreFactors = z.infer<typeof ScoreFactorsSchema>;
export type TrustFlag = z.infer<typeof TrustFlagSchema>;
export type TrustScoreResponse = z.infer<typeof TrustScoreResponseSchema>;
export type TrustScoreHistoryItem = z.infer<typeof TrustScoreHistoryItemSchema>;
export type TrustScoreHistoryResponse = z.infer<typeof TrustScoreHistoryResponseSchema>;
export type BatchTrustScoreRequest = z.infer<typeof BatchTrustScoreRequestSchema>;
export type BatchTrustScoreResponse = z.infer<typeof BatchTrustScoreResponseSchema>;
