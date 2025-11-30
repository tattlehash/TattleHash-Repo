/**
 * LLM Monitoring Core
 *
 * Orchestrates analyses using multiple agents based on monitoring mode.
 * Manages the full lifecycle of an analysis request.
 */

import { execute, query, queryOne } from '../db';
import { createError } from '../errors';
import { Env } from '../types';
import type {
    LlmAnalysis,
    LlmAgentResult,
    LlmFlag,
    LlmMonitoringConfig,
} from '../db/types';
import { LlmClient } from './client';
import { createAgent, getRegisteredAgentTypes } from './agents';
import {
    CreateAnalysisInput,
    MonitoringMode,
    AgentType,
    AgentOutput,
    RiskLevel,
    Recommendation,
    MONITORING_MODES,
    DEFAULT_RISK_THRESHOLDS,
    MONITORING_DEFAULTS,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface AnalysisResult {
    analysis_id: string;
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
    risk_score: number;
    risk_level: RiskLevel;
    recommendation: Recommendation;
    summary: string;
    flags: LlmFlag[];
    agent_results: Array<{
        agent_type: AgentType;
        agent_name: string;
        status: string;
        confidence_score: number;
        flags_raised: number;
    }>;
    tokens_used: number;
    processing_time_ms: number;
}

export interface AnalysisOptions {
    force_refresh?: boolean; // Skip cache
    timeout_ms?: number;
    agents_override?: AgentType[]; // Override which agents to run
}

// ============================================================================
// Analysis Management
// ============================================================================

/**
 * Create and run an analysis
 */
export async function runAnalysis(
    env: Env,
    input: CreateAnalysisInput,
    targetData: Record<string, unknown>,
    userId?: string,
    options?: AnalysisOptions
): Promise<AnalysisResult> {
    const client = LlmClient.fromEnv(env);
    if (!client?.isConfigured()) {
        throw createError('FEATURE_DISABLED', { message: 'LLM monitoring not configured' });
    }

    const startTime = Date.now();
    const analysisId = crypto.randomUUID();

    // Get monitoring mode configuration
    const modeConfig = await getMonitoringConfig(env, input.monitoring_mode);

    // Create analysis record
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO llm_analyses (
            id, target_type, target_id, monitoring_mode, trigger_type,
            requested_by_user_id, status, total_tokens_used, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', 0, ?)`,
        [
            analysisId,
            input.target_type,
            input.target_id,
            input.monitoring_mode,
            input.trigger_type,
            userId ?? null,
            startTime,
        ]
    );

    // Update started_at
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE llm_analyses SET started_at = ? WHERE id = ?',
        [Date.now(), analysisId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'llm_analysis_started',
        analysis_id: analysisId,
        target_type: input.target_type,
        target_id: input.target_id,
        mode: input.monitoring_mode,
    }));

    // Determine which agents to run
    const agentsToRun = options?.agents_override ?? getAgentsForMode(modeConfig);

    // Run agents
    const agentResults: Array<{
        agent_type: AgentType;
        agent_name: string;
        status: string;
        output?: AgentOutput;
        tokens: number;
        latencyMs: number;
        error?: string;
    }> = [];

    let totalTokens = 0;
    const flags: LlmFlag[] = [];

    for (const agentType of agentsToRun) {
        const agent = createAgent(agentType, client);
        if (!agent) {
            console.error(`Agent not found: ${agentType}`);
            continue;
        }

        const agentResultId = crypto.randomUUID();

        // Create agent result record
        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO llm_agent_results (
                id, analysis_id, agent_type, agent_name, agent_version,
                status, flags_raised, tokens_used, started_at
            ) VALUES (?, ?, ?, ?, ?, 'RUNNING', 0, 0, ?)`,
            [agentResultId, analysisId, agentType, agent.name, agent.version, Date.now()]
        );

        try {
            const result = await agent.analyze({
                analysis_id: analysisId,
                target_type: input.target_type,
                target_id: input.target_id,
                target_data: targetData,
                context: input.context,
                monitoring_mode: input.monitoring_mode,
            });

            if (result.ok) {
                totalTokens += result.tokens;

                // Process flags from this agent
                for (const flag of result.output.flags) {
                    const flagId = crypto.randomUUID();
                    flags.push({
                        id: flagId,
                        analysis_id: analysisId,
                        agent_result_id: agentResultId,
                        flag_type: flag.flag_type,
                        severity: flag.severity,
                        title: flag.title,
                        description: flag.description,
                        evidence: flag.evidence ? JSON.stringify(flag.evidence) : undefined,
                        resolved: false,
                        created_at: Date.now(),
                    });

                    // Insert flag into DB
                    await execute(
                        env.TATTLEHASH_DB,
                        `INSERT INTO llm_flags (
                            id, analysis_id, agent_result_id, flag_type, severity,
                            title, description, evidence, resolved, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
                        [
                            flagId,
                            analysisId,
                            agentResultId,
                            flag.flag_type,
                            flag.severity,
                            flag.title,
                            flag.description,
                            flag.evidence ? JSON.stringify(flag.evidence) : null,
                            Date.now(),
                        ]
                    );
                }

                // Update agent result
                await execute(
                    env.TATTLEHASH_DB,
                    `UPDATE llm_agent_results SET
                        status = 'COMPLETED',
                        confidence_score = ?,
                        raw_output = ?,
                        structured_output = ?,
                        flags_raised = ?,
                        tokens_used = ?,
                        latency_ms = ?,
                        completed_at = ?
                    WHERE id = ?`,
                    [
                        result.output.confidence_score,
                        result.output.raw_analysis ?? null,
                        JSON.stringify(result.output),
                        result.output.flags.length,
                        result.tokens,
                        result.latencyMs,
                        Date.now(),
                        agentResultId,
                    ]
                );

                agentResults.push({
                    agent_type: agentType,
                    agent_name: agent.name,
                    status: 'COMPLETED',
                    output: result.output,
                    tokens: result.tokens,
                    latencyMs: result.latencyMs,
                });
            } else {
                // Agent failed
                await execute(
                    env.TATTLEHASH_DB,
                    `UPDATE llm_agent_results SET
                        status = 'FAILED',
                        completed_at = ?
                    WHERE id = ?`,
                    [Date.now(), agentResultId]
                );

                agentResults.push({
                    agent_type: agentType,
                    agent_name: agent.name,
                    status: 'FAILED',
                    tokens: 0,
                    latencyMs: 0,
                    error: result.error,
                });
            }
        } catch (error: any) {
            console.error(`Agent ${agentType} error:`, error);

            await execute(
                env.TATTLEHASH_DB,
                `UPDATE llm_agent_results SET status = 'FAILED', completed_at = ? WHERE id = ?`,
                [Date.now(), agentResultId]
            );

            agentResults.push({
                agent_type: agentType,
                agent_name: agent.name,
                status: 'FAILED',
                tokens: 0,
                latencyMs: 0,
                error: error.message,
            });
        }
    }

    // Calculate overall risk score
    const { riskScore, riskLevel } = calculateRiskScore(agentResults, flags, modeConfig);

    // Determine recommendation
    const recommendation = determineRecommendation(riskScore, riskLevel, modeConfig);

    // Generate summary
    const summary = generateSummary(agentResults, flags, riskLevel);

    const processingTimeMs = Date.now() - startTime;

    // Determine final status
    const completedAgents = agentResults.filter(r => r.status === 'COMPLETED').length;
    const status = completedAgents === agentsToRun.length ? 'COMPLETED' :
        completedAgents > 0 ? 'PARTIAL' : 'FAILED';

    // Update analysis record
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE llm_analyses SET
            status = ?,
            risk_score = ?,
            risk_level = ?,
            recommendation = ?,
            summary = ?,
            total_tokens_used = ?,
            processing_time_ms = ?,
            completed_at = ?,
            expires_at = ?
        WHERE id = ?`,
        [
            status,
            riskScore,
            riskLevel,
            recommendation,
            summary,
            totalTokens,
            processingTimeMs,
            Date.now(),
            Date.now() + MONITORING_DEFAULTS.ANALYSIS_CACHE_TTL_MS,
            analysisId,
        ]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'llm_analysis_completed',
        analysis_id: analysisId,
        status,
        risk_score: riskScore,
        risk_level: riskLevel,
        recommendation,
        flags_count: flags.length,
        tokens_used: totalTokens,
        processing_time_ms: processingTimeMs,
    }));

    return {
        analysis_id: analysisId,
        status,
        risk_score: riskScore,
        risk_level: riskLevel,
        recommendation,
        summary,
        flags,
        agent_results: agentResults.map(r => ({
            agent_type: r.agent_type,
            agent_name: r.agent_name,
            status: r.status,
            confidence_score: r.output?.confidence_score ?? 0,
            flags_raised: r.output?.flags.length ?? 0,
        })),
        tokens_used: totalTokens,
        processing_time_ms: processingTimeMs,
    };
}

/**
 * Get an existing analysis by ID
 */
export async function getAnalysis(
    env: Env,
    analysisId: string
): Promise<LlmAnalysis | null> {
    return queryOne<LlmAnalysis>(
        env.TATTLEHASH_DB,
        'SELECT * FROM llm_analyses WHERE id = ?',
        [analysisId]
    );
}

/**
 * Get analysis flags
 */
export async function getAnalysisFlags(
    env: Env,
    analysisId: string
): Promise<LlmFlag[]> {
    return query<LlmFlag>(
        env.TATTLEHASH_DB,
        'SELECT * FROM llm_flags WHERE analysis_id = ? ORDER BY severity DESC, created_at ASC',
        [analysisId]
    );
}

/**
 * Get analysis agent results
 */
export async function getAgentResults(
    env: Env,
    analysisId: string
): Promise<LlmAgentResult[]> {
    return query<LlmAgentResult>(
        env.TATTLEHASH_DB,
        'SELECT * FROM llm_agent_results WHERE analysis_id = ? ORDER BY started_at ASC',
        [analysisId]
    );
}

/**
 * Get cached analysis if available
 */
export async function getCachedAnalysis(
    env: Env,
    targetType: string,
    targetId: string
): Promise<LlmAnalysis | null> {
    return queryOne<LlmAnalysis>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_analyses
         WHERE target_type = ? AND target_id = ?
         AND status = 'COMPLETED'
         AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [targetType, targetId, Date.now()]
    );
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get monitoring mode configuration
 */
export async function getMonitoringConfig(
    env: Env,
    mode: MonitoringMode
): Promise<LlmMonitoringConfig> {
    const config = await queryOne<LlmMonitoringConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM llm_monitoring_configs WHERE mode = ?',
        [mode]
    );

    if (config) {
        return config;
    }

    // Return default config if not in DB
    const defaults = MONITORING_MODES[mode];
    return {
        mode,
        description: defaults.description,
        risk_threshold_low: DEFAULT_RISK_THRESHOLDS.LOW,
        risk_threshold_medium: DEFAULT_RISK_THRESHOLDS.MEDIUM,
        risk_threshold_high: DEFAULT_RISK_THRESHOLDS.HIGH,
        required_agents: JSON.stringify(getDefaultRequiredAgents(mode)),
        optional_agents: JSON.stringify(getDefaultOptionalAgents(mode)),
        auto_block_threshold: mode === 'PRECISION' ? 80 : 90,
        require_human_review_threshold: mode === 'PRECISION' ? 50 : 70,
        analysis_timeout_ms: mode === 'PRECISION' ? 45000 : 20000,
        updated_at: Date.now(),
    };
}

/**
 * Get agents to run for a monitoring mode
 */
function getAgentsForMode(config: LlmMonitoringConfig): AgentType[] {
    const required = JSON.parse(config.required_agents) as AgentType[];
    const optional = config.optional_agents
        ? JSON.parse(config.optional_agents) as AgentType[]
        : [];

    // For now, run required + optional. Could add logic to conditionally include optional.
    return [...required, ...optional];
}

function getDefaultRequiredAgents(mode: MonitoringMode): AgentType[] {
    switch (mode) {
        case 'EXPLORATORY':
            return ['TRANSACTION_MONITOR'];
        case 'BALANCED':
            return ['TRANSACTION_MONITOR', 'FRAUD_ANALYZER'];
        case 'PRECISION':
            return ['TRANSACTION_MONITOR', 'FRAUD_ANALYZER', 'COMPLIANCE_AUDITOR'];
    }
}

function getDefaultOptionalAgents(mode: MonitoringMode): AgentType[] {
    switch (mode) {
        case 'EXPLORATORY':
            return ['FRAUD_ANALYZER'];
        case 'BALANCED':
            return ['COMPLIANCE_AUDITOR'];
        case 'PRECISION':
            return [];
    }
}

// ============================================================================
// Risk Calculation
// ============================================================================

/**
 * Calculate overall risk score from agent results
 */
function calculateRiskScore(
    agentResults: Array<{ output?: AgentOutput; status: string }>,
    flags: LlmFlag[],
    config: LlmMonitoringConfig
): { riskScore: number; riskLevel: RiskLevel } {
    // Base score from agent risk contributions
    let weightedScore = 0;
    let totalWeight = 0;

    for (const result of agentResults) {
        if (result.status === 'COMPLETED' && result.output) {
            const weight = result.output.confidence_score;
            weightedScore += result.output.risk_contribution * weight;
            totalWeight += weight;
        }
    }

    let riskScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

    // Adjust based on flags
    const flagBoost = calculateFlagBoost(flags);
    riskScore = Math.min(100, riskScore + flagBoost);

    // Determine risk level based on thresholds
    const riskLevel = getRiskLevel(riskScore, config);

    return { riskScore, riskLevel };
}

/**
 * Calculate additional risk from flags
 */
function calculateFlagBoost(flags: LlmFlag[]): number {
    const severityWeights: Record<string, number> = {
        CRITICAL: 15,
        HIGH: 10,
        MEDIUM: 5,
        LOW: 2,
        INFO: 0,
    };

    let boost = 0;
    for (const flag of flags) {
        boost += severityWeights[flag.severity] ?? 0;
    }

    // Cap the boost at 30 points
    return Math.min(30, boost);
}

/**
 * Get risk level from score
 */
function getRiskLevel(score: number, config: LlmMonitoringConfig): RiskLevel {
    if (score < config.risk_threshold_low) return 'LOW';
    if (score < config.risk_threshold_medium) return 'MEDIUM';
    if (score < config.risk_threshold_high) return 'HIGH';
    return 'CRITICAL';
}

/**
 * Determine recommendation based on risk
 */
function determineRecommendation(
    score: number,
    level: RiskLevel,
    config: LlmMonitoringConfig
): Recommendation {
    if (config.auto_block_threshold && score >= config.auto_block_threshold) {
        return 'BLOCK';
    }

    if (config.require_human_review_threshold && score >= config.require_human_review_threshold) {
        return 'REVIEW';
    }

    switch (level) {
        case 'LOW':
            return 'PROCEED';
        case 'MEDIUM':
            return 'CAUTION';
        case 'HIGH':
            return 'REVIEW';
        case 'CRITICAL':
            return 'BLOCK';
    }
}

/**
 * Generate a human-readable summary
 */
function generateSummary(
    agentResults: Array<{ agent_name: string; output?: AgentOutput; status: string }>,
    flags: LlmFlag[],
    riskLevel: RiskLevel
): string {
    const completedAgents = agentResults.filter(r => r.status === 'COMPLETED');
    const criticalFlags = flags.filter(f => f.severity === 'CRITICAL');
    const highFlags = flags.filter(f => f.severity === 'HIGH');

    const parts: string[] = [];

    parts.push(`Risk Level: ${riskLevel}.`);
    parts.push(`${completedAgents.length} agent(s) completed analysis.`);

    if (criticalFlags.length > 0) {
        parts.push(`${criticalFlags.length} CRITICAL concern(s) identified.`);
    } else if (highFlags.length > 0) {
        parts.push(`${highFlags.length} HIGH severity flag(s) raised.`);
    } else if (flags.length > 0) {
        parts.push(`${flags.length} flag(s) raised for review.`);
    } else {
        parts.push('No significant concerns detected.');
    }

    return parts.join(' ');
}
