/**
 * LLM Monitoring Types and Schemas
 *
 * Defines Zod schemas for validation and constants for the monitoring system.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const MONITORING_DEFAULTS = {
    DEFAULT_MODEL: 'gpt-4o-mini',
    DEFAULT_TEMPERATURE: 0.3,
    DEFAULT_MAX_TOKENS: 2000,
    ANALYSIS_CACHE_TTL_MS: 30 * 60 * 1000, // 30 minutes
    RISK_SCORE_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
    URL_SCAN_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
};

export const MONITORING_MODES = {
    EXPLORATORY: {
        name: 'Exploratory Bot',
        description: 'First-time users, complex deals. Asks clarifying questions, surfaces concerns.',
        strictness: 'low',
    },
    BALANCED: {
        name: 'Balanced Sentinel',
        description: 'Standard monitoring. Flags anomalies without being intrusive.',
        strictness: 'medium',
    },
    PRECISION: {
        name: 'Precision Guard',
        description: 'High-value transactions. Strict verification, minimal tolerance.',
        strictness: 'high',
    },
} as const;

export const AGENT_TYPES = {
    TRANSACTION_MONITOR: {
        name: 'Core Transaction Monitor',
        description: 'Real-time analysis of transaction patterns',
        priority: 1,
    },
    FRAUD_ANALYZER: {
        name: 'Fraud Pattern Analyzer',
        description: 'Specialized in detecting scam signatures',
        priority: 2,
    },
    COMPLIANCE_AUDITOR: {
        name: 'Compliance Auditor',
        description: 'Regulatory flag detection',
        priority: 3,
    },
    CUSTOM: {
        name: 'Custom Agent',
        description: 'Plug-and-play extensibility',
        priority: 99,
    },
} as const;

export const FLAG_TYPES = {
    SCAM_PATTERN: { severity: 'HIGH', category: 'fraud' },
    SUSPICIOUS_URL: { severity: 'HIGH', category: 'fraud' },
    AMOUNT_ANOMALY: { severity: 'MEDIUM', category: 'behavioral' },
    TIMING_ANOMALY: { severity: 'LOW', category: 'behavioral' },
    IDENTITY_MISMATCH: { severity: 'HIGH', category: 'identity' },
    BEHAVIOR_PATTERN: { severity: 'MEDIUM', category: 'behavioral' },
    COMPLIANCE_ISSUE: { severity: 'HIGH', category: 'compliance' },
    VELOCITY_SPIKE: { severity: 'MEDIUM', category: 'behavioral' },
    COUNTERPARTY_RISK: { severity: 'HIGH', category: 'risk' },
    NETWORK_RISK: { severity: 'MEDIUM', category: 'risk' },
    CUSTOM: { severity: 'INFO', category: 'other' },
} as const;

// Risk level thresholds (can be overridden per monitoring mode)
export const DEFAULT_RISK_THRESHOLDS = {
    LOW: 25, // Score 0-24 = LOW
    MEDIUM: 50, // Score 25-49 = MEDIUM
    HIGH: 75, // Score 50-74 = HIGH
    // Score 75+ = CRITICAL
};

// ============================================================================
// Zod Schemas
// ============================================================================

export const TargetTypeSchema = z.enum([
    'CHALLENGE',
    'DISPUTE',
    'ENF_BUNDLE',
    'USER',
    'TRANSACTION',
]);

export const MonitoringModeSchema = z.enum(['EXPLORATORY', 'BALANCED', 'PRECISION']);

export const TriggerTypeSchema = z.enum(['AUTO', 'MANUAL', 'THRESHOLD', 'SCHEDULED']);

export const AgentTypeSchema = z.enum([
    'TRANSACTION_MONITOR',
    'FRAUD_ANALYZER',
    'COMPLIANCE_AUDITOR',
    'CUSTOM',
]);

export const FlagTypeSchema = z.enum([
    'SCAM_PATTERN',
    'SUSPICIOUS_URL',
    'AMOUNT_ANOMALY',
    'TIMING_ANOMALY',
    'IDENTITY_MISMATCH',
    'BEHAVIOR_PATTERN',
    'COMPLIANCE_ISSUE',
    'VELOCITY_SPIKE',
    'COUNTERPARTY_RISK',
    'NETWORK_RISK',
    'CUSTOM',
]);

export const FlagSeveritySchema = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const RecommendationSchema = z.enum(['PROCEED', 'CAUTION', 'BLOCK', 'REVIEW']);

// ============================================================================
// Request Schemas
// ============================================================================

export const CreateAnalysisSchema = z.object({
    target_type: TargetTypeSchema,
    target_id: z.string().min(1),
    monitoring_mode: MonitoringModeSchema.optional().default('BALANCED'),
    trigger_type: TriggerTypeSchema.optional().default('AUTO'),
    context: z.record(z.string(), z.unknown()).optional(), // Additional context for analysis
});

export const AnalyzeTransactionSchema = z.object({
    challenge_id: z.string().min(1),
    monitoring_mode: MonitoringModeSchema.optional().default('BALANCED'),
    transaction_data: z.object({
        amount: z.string().optional(),
        currency: z.string().optional(),
        counterparty_wallet: z.string().optional(),
        description: z.string().optional(),
        urls: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
});

export const ScanUrlSchema = z.object({
    url: z.string().url(),
    context: z.object({
        analysis_id: z.string().optional(),
        target_type: TargetTypeSchema.optional(),
        target_id: z.string().optional(),
    }).optional(),
});

export const GetRiskScoreSchema = z.object({
    entity_type: z.enum(['USER', 'WALLET', 'CHALLENGE', 'TRANSACTION']),
    entity_id: z.string().min(1),
    recalculate: z.boolean().optional().default(false),
});

// ============================================================================
// Agent Schemas
// ============================================================================

export const AgentInputSchema = z.object({
    analysis_id: z.string(),
    target_type: TargetTypeSchema,
    target_id: z.string(),
    target_data: z.record(z.string(), z.unknown()), // The actual data to analyze
    context: z.record(z.string(), z.unknown()).optional(),
    monitoring_mode: MonitoringModeSchema,
});

export const AgentFlagSchema = z.object({
    flag_type: FlagTypeSchema,
    severity: FlagSeveritySchema,
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    evidence: z.record(z.string(), z.unknown()).optional(),
});

export const AgentOutputSchema = z.object({
    confidence_score: z.number().min(0).max(1),
    risk_contribution: z.number().min(0).max(100), // How much this agent contributes to risk score
    flags: z.array(AgentFlagSchema),
    summary: z.string(),
    recommendations: z.array(z.string()).optional(),
    raw_analysis: z.string().optional(), // Full LLM response for debugging
});

// ============================================================================
// LLM Message Types
// ============================================================================

export const LlmMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
});

export const LlmRequestSchema = z.object({
    model: z.string().optional(),
    messages: z.array(LlmMessageSchema),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).max(128000).optional(),
    response_format: z.object({
        type: z.literal('json_object'),
    }).optional(),
});

export const LlmResponseSchema = z.object({
    id: z.string(),
    model: z.string(),
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
    }),
    choices: z.array(z.object({
        message: z.object({
            role: z.literal('assistant'),
            content: z.string(),
        }),
        finish_reason: z.string(),
    })),
});

// ============================================================================
// Type Exports
// ============================================================================

export type TargetType = z.infer<typeof TargetTypeSchema>;
export type MonitoringMode = z.infer<typeof MonitoringModeSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type FlagType = z.infer<typeof FlagTypeSchema>;
export type FlagSeverity = z.infer<typeof FlagSeveritySchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;

export type CreateAnalysisInput = z.infer<typeof CreateAnalysisSchema>;
export type AnalyzeTransactionInput = z.infer<typeof AnalyzeTransactionSchema>;
export type ScanUrlInput = z.infer<typeof ScanUrlSchema>;
export type GetRiskScoreInput = z.infer<typeof GetRiskScoreSchema>;

export type AgentInput = z.infer<typeof AgentInputSchema>;
export type AgentFlag = z.infer<typeof AgentFlagSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export type LlmMessage = z.infer<typeof LlmMessageSchema>;
export type LlmRequest = z.infer<typeof LlmRequestSchema>;
export type LlmResponse = z.infer<typeof LlmResponseSchema>;
