/**
 * Trust Score Module
 *
 * Real-time risk assessment for wallet addresses.
 */

// Types
export type {
    RiskLevel,
    FlagType,
    FlagSeverity,
    TriggerReason,
    ScoreFactor,
    ScoreFactors,
    TrustFlag,
    TrustScoreResponse,
    TrustScoreHistoryItem,
    TrustScoreHistoryResponse,
    BatchTrustScoreRequest,
    BatchTrustScoreResponse,
    TrustScoreRecord,
    TrustScoreHistoryRecord,
    WalletFlagRecord,
    WalletStatsRecord,
} from './types';

export {
    TRUST_SCORE_DEFAULTS,
    RISK_THRESHOLDS,
    FACTOR_WEIGHTS,
    FLAG_DEFINITIONS,
    WalletAddressSchema,
    RiskLevelSchema,
    FlagTypeSchema,
    FlagSeveritySchema,
    TriggerReasonSchema,
    TrustScoreResponseSchema,
    TrustScoreHistoryResponseSchema,
    BatchTrustScoreRequestSchema,
    BatchTrustScoreResponseSchema,
    GetTrustScoreParamsSchema,
    GetHistoryParamsSchema,
} from './types';

// Service
export {
    getTrustScore,
    getBatchTrustScores,
    getTrustScoreHistory,
    invalidateTrustScore,
    addWalletFlag,
    resolveWalletFlag,
    normalizeWallet,
    getRiskLevel,
    getCacheKey,
} from './service';
