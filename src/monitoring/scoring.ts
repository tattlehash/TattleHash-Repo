/**
 * Risk Scoring Engine
 *
 * Calculates and tracks risk scores for entities over time.
 * Supports adaptive scoring based on history and context.
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type { LlmRiskScore, LlmAnalysis, LlmFlag } from '../db/types';
import {
    RiskLevel,
    GetRiskScoreInput,
    DEFAULT_RISK_THRESHOLDS,
    MONITORING_DEFAULTS,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface RiskScoreResult {
    entity_type: string;
    entity_id: string;
    score: number;
    risk_level: RiskLevel;
    breakdown: RiskBreakdown;
    history: RiskHistory[];
    calculated_at: number;
    valid_until: number;
}

export interface RiskBreakdown {
    fraud: number;
    compliance: number;
    behavioral: number;
    network: number;
    velocity: number;
    historical: number;
}

export interface RiskHistory {
    score: number;
    risk_level: RiskLevel;
    calculated_at: number;
    source_analysis_id?: string;
}

export interface ScoreComponents {
    fraud_score: number;
    compliance_score: number;
    behavioral_score: number;
    network_score: number;
    velocity_score: number;
}

// ============================================================================
// Risk Score Management
// ============================================================================

/**
 * Get or calculate risk score for an entity
 */
export async function getRiskScore(
    env: Env,
    input: GetRiskScoreInput
): Promise<RiskScoreResult> {
    // Check for cached valid score
    if (!input.recalculate) {
        const cached = await getCachedRiskScore(env, input.entity_type, input.entity_id);
        if (cached) {
            const breakdown = cached.score_breakdown
                ? JSON.parse(cached.score_breakdown)
                : getEmptyBreakdown();

            return {
                entity_type: input.entity_type,
                entity_id: input.entity_id,
                score: cached.score,
                risk_level: cached.risk_level as RiskLevel,
                breakdown,
                history: await getRiskHistory(env, input.entity_type, input.entity_id),
                calculated_at: cached.calculated_at,
                valid_until: cached.valid_until ?? cached.calculated_at + MONITORING_DEFAULTS.RISK_SCORE_TTL_MS,
            };
        }
    }

    // Calculate new score
    const components = await calculateScoreComponents(env, input.entity_type, input.entity_id);
    const { score, breakdown } = aggregateComponents(components);
    const riskLevel = scoreToRiskLevel(score);

    // Store the new score
    const scoreId = crypto.randomUUID();
    const now = Date.now();
    const validUntil = now + MONITORING_DEFAULTS.RISK_SCORE_TTL_MS;

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO llm_risk_scores (
            id, entity_type, entity_id, score, risk_level,
            score_breakdown, scoring_version, calculated_at, valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, '1.0', ?, ?)`,
        [
            scoreId,
            input.entity_type,
            input.entity_id,
            score,
            riskLevel,
            JSON.stringify(breakdown),
            now,
            validUntil,
        ]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'risk_score_calculated',
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        score,
        risk_level: riskLevel,
    }));

    return {
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        score,
        risk_level: riskLevel,
        breakdown,
        history: await getRiskHistory(env, input.entity_type, input.entity_id),
        calculated_at: now,
        valid_until: validUntil,
    };
}

/**
 * Get cached risk score if valid
 */
async function getCachedRiskScore(
    env: Env,
    entityType: string,
    entityId: string
): Promise<LlmRiskScore | null> {
    return queryOne<LlmRiskScore>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_risk_scores
         WHERE entity_type = ? AND entity_id = ?
         AND valid_until > ?
         ORDER BY calculated_at DESC
         LIMIT 1`,
        [entityType, entityId, Date.now()]
    );
}

/**
 * Get risk score history for an entity
 */
async function getRiskHistory(
    env: Env,
    entityType: string,
    entityId: string,
    limit = 10
): Promise<RiskHistory[]> {
    const rows = await query<LlmRiskScore>(
        env.TATTLEHASH_DB,
        `SELECT score, risk_level, calculated_at, analysis_id
         FROM llm_risk_scores
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY calculated_at DESC
         LIMIT ?`,
        [entityType, entityId, limit]
    );

    return rows.map(row => ({
        score: row.score,
        risk_level: row.risk_level as RiskLevel,
        calculated_at: row.calculated_at,
        source_analysis_id: row.analysis_id ?? undefined,
    }));
}

/**
 * Update risk score from analysis results
 */
export async function updateRiskScoreFromAnalysis(
    env: Env,
    analysis: LlmAnalysis,
    flags: LlmFlag[]
): Promise<void> {
    if (!analysis.risk_score) return;

    // Determine entity type and ID based on target
    const entityType = analysis.target_type === 'USER' ? 'USER' :
        analysis.target_type === 'TRANSACTION' ? 'TRANSACTION' :
            'CHALLENGE';

    const scoreId = crypto.randomUUID();
    const now = Date.now();

    // Calculate breakdown from flags
    const breakdown = calculateBreakdownFromFlags(flags);

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO llm_risk_scores (
            id, entity_type, entity_id, score, risk_level,
            score_breakdown, analysis_id, scoring_version, calculated_at, valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '1.0', ?, ?)`,
        [
            scoreId,
            entityType,
            analysis.target_id,
            analysis.risk_score,
            analysis.risk_level,
            JSON.stringify(breakdown),
            analysis.id,
            now,
            now + MONITORING_DEFAULTS.RISK_SCORE_TTL_MS,
        ]
    );
}

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate score components from historical data
 */
async function calculateScoreComponents(
    env: Env,
    entityType: string,
    entityId: string
): Promise<ScoreComponents> {
    // Get recent analyses for this entity
    const analyses = await query<LlmAnalysis>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_analyses
         WHERE target_type = ? AND target_id = ?
         AND status = 'COMPLETED'
         ORDER BY created_at DESC
         LIMIT 10`,
        [entityType, entityId]
    );

    // Get recent flags
    const flags = await query<LlmFlag>(
        env.TATTLEHASH_DB,
        `SELECT f.* FROM llm_flags f
         JOIN llm_analyses a ON f.analysis_id = a.id
         WHERE a.target_type = ? AND a.target_id = ?
         AND f.resolved = 0
         ORDER BY f.created_at DESC
         LIMIT 50`,
        [entityType, entityId]
    );

    // Calculate components
    return {
        fraud_score: calculateFraudComponent(flags),
        compliance_score: calculateComplianceComponent(flags),
        behavioral_score: calculateBehavioralComponent(analyses, flags),
        network_score: calculateNetworkComponent(flags),
        velocity_score: calculateVelocityComponent(analyses),
    };
}

function calculateFraudComponent(flags: LlmFlag[]): number {
    const fraudFlags = flags.filter(f =>
        f.flag_type === 'SCAM_PATTERN' ||
        f.flag_type === 'SUSPICIOUS_URL' ||
        f.flag_type === 'COUNTERPARTY_RISK'
    );

    return Math.min(100, fraudFlags.reduce((sum, f) => {
        const weight = f.severity === 'CRITICAL' ? 30 :
            f.severity === 'HIGH' ? 20 :
                f.severity === 'MEDIUM' ? 10 : 5;
        return sum + weight;
    }, 0));
}

function calculateComplianceComponent(flags: LlmFlag[]): number {
    const complianceFlags = flags.filter(f =>
        f.flag_type === 'COMPLIANCE_ISSUE'
    );

    return Math.min(100, complianceFlags.reduce((sum, f) => {
        const weight = f.severity === 'CRITICAL' ? 40 :
            f.severity === 'HIGH' ? 25 :
                f.severity === 'MEDIUM' ? 15 : 5;
        return sum + weight;
    }, 0));
}

function calculateBehavioralComponent(analyses: LlmAnalysis[], flags: LlmFlag[]): number {
    const behavioralFlags = flags.filter(f =>
        f.flag_type === 'AMOUNT_ANOMALY' ||
        f.flag_type === 'TIMING_ANOMALY' ||
        f.flag_type === 'BEHAVIOR_PATTERN' ||
        f.flag_type === 'VELOCITY_SPIKE'
    );

    let score = behavioralFlags.reduce((sum, f) => {
        const weight = f.severity === 'CRITICAL' ? 25 :
            f.severity === 'HIGH' ? 15 :
                f.severity === 'MEDIUM' ? 8 : 3;
        return sum + weight;
    }, 0);

    // Historical trend adjustment
    if (analyses.length >= 3) {
        const recentScores = analyses.slice(0, 3).map(a => a.risk_score ?? 0);
        const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        if (avgRecent > 50) {
            score += 10; // Persistent high risk adds to behavioral score
        }
    }

    return Math.min(100, score);
}

function calculateNetworkComponent(flags: LlmFlag[]): number {
    const networkFlags = flags.filter(f =>
        f.flag_type === 'NETWORK_RISK' ||
        f.flag_type === 'IDENTITY_MISMATCH'
    );

    return Math.min(100, networkFlags.reduce((sum, f) => {
        const weight = f.severity === 'CRITICAL' ? 35 :
            f.severity === 'HIGH' ? 20 :
                f.severity === 'MEDIUM' ? 10 : 5;
        return sum + weight;
    }, 0));
}

function calculateVelocityComponent(analyses: LlmAnalysis[]): number {
    if (analyses.length < 2) return 0;

    // Check for high activity in short time
    const now = Date.now();
    const last24h = analyses.filter(a => a.created_at > now - 24 * 60 * 60 * 1000);
    const lastHour = analyses.filter(a => a.created_at > now - 60 * 60 * 1000);

    let score = 0;

    // More than 5 analyses in last hour is suspicious
    if (lastHour.length > 5) score += 30;
    else if (lastHour.length > 3) score += 15;

    // More than 20 in last 24h is suspicious
    if (last24h.length > 20) score += 25;
    else if (last24h.length > 10) score += 10;

    return Math.min(100, score);
}

/**
 * Aggregate component scores into final score
 */
function aggregateComponents(components: ScoreComponents): {
    score: number;
    breakdown: RiskBreakdown;
} {
    // Weights for each component
    const weights = {
        fraud: 0.35,
        compliance: 0.25,
        behavioral: 0.20,
        network: 0.10,
        velocity: 0.10,
    };

    const weighted =
        components.fraud_score * weights.fraud +
        components.compliance_score * weights.compliance +
        components.behavioral_score * weights.behavioral +
        components.network_score * weights.network +
        components.velocity_score * weights.velocity;

    return {
        score: Math.round(weighted),
        breakdown: {
            fraud: components.fraud_score,
            compliance: components.compliance_score,
            behavioral: components.behavioral_score,
            network: components.network_score,
            velocity: components.velocity_score,
            historical: 0, // Populated separately if needed
        },
    };
}

/**
 * Calculate breakdown from flags
 */
function calculateBreakdownFromFlags(flags: LlmFlag[]): RiskBreakdown {
    const components: ScoreComponents = {
        fraud_score: calculateFraudComponent(flags),
        compliance_score: calculateComplianceComponent(flags),
        behavioral_score: 0, // Can't calculate without historical data
        network_score: calculateNetworkComponent(flags),
        velocity_score: 0, // Can't calculate without historical data
    };

    const { breakdown } = aggregateComponents(components);
    return breakdown;
}

function getEmptyBreakdown(): RiskBreakdown {
    return {
        fraud: 0,
        compliance: 0,
        behavioral: 0,
        network: 0,
        velocity: 0,
        historical: 0,
    };
}

/**
 * Convert score to risk level
 */
function scoreToRiskLevel(score: number): RiskLevel {
    if (score < DEFAULT_RISK_THRESHOLDS.LOW) return 'LOW';
    if (score < DEFAULT_RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
    if (score < DEFAULT_RISK_THRESHOLDS.HIGH) return 'HIGH';
    return 'CRITICAL';
}

// ============================================================================
// Auto Mode (Adaptive Scoring)
// ============================================================================

/**
 * Get recommended monitoring mode based on entity risk history
 * This implements "Auto Mode" from VISION.md
 */
export async function getRecommendedMonitoringMode(
    env: Env,
    entityType: string,
    entityId: string
): Promise<'EXPLORATORY' | 'BALANCED' | 'PRECISION'> {
    // Check for existing risk score
    const riskScore = await getCachedRiskScore(env, entityType, entityId);

    if (!riskScore) {
        // New entity - use exploratory
        return 'EXPLORATORY';
    }

    // Get recent analyses
    const recentAnalyses = await query<LlmAnalysis>(
        env.TATTLEHASH_DB,
        `SELECT risk_score FROM llm_analyses
         WHERE target_type = ? AND target_id = ?
         AND status = 'COMPLETED'
         ORDER BY created_at DESC
         LIMIT 5`,
        [entityType, entityId]
    );

    if (recentAnalyses.length < 2) {
        // Not enough history - use balanced
        return 'BALANCED';
    }

    // Calculate average recent risk
    const avgRisk = recentAnalyses.reduce((sum, a) => sum + (a.risk_score ?? 0), 0) / recentAnalyses.length;

    // Check for risk trend
    const isIncreasing = recentAnalyses.length >= 3 &&
        (recentAnalyses[0].risk_score ?? 0) > (recentAnalyses[2].risk_score ?? 0) + 10;

    // Determine mode based on risk level and trend
    if (avgRisk >= 60 || isIncreasing) {
        return 'PRECISION';
    } else if (avgRisk >= 30) {
        return 'BALANCED';
    } else {
        return 'EXPLORATORY';
    }
}
