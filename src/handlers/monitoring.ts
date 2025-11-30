/**
 * LLM Monitoring API Handlers
 *
 * Endpoints for analysis, risk scoring, and URL scanning.
 */

import { ok, err } from '../lib/http';
import { Env } from '../types';
import { authenticateRequest } from '../middleware/auth';
import { query } from '../db';
import {
    runAnalysis,
    getAnalysis,
    getAnalysisFlags,
    getAgentResults,
    getRiskScore,
    getRecommendedMonitoringMode,
    scanUrl,
    scanUrls,
    extractUrls,
    CreateAnalysisSchema,
    AnalyzeTransactionSchema,
    ScanUrlSchema,
} from '../monitoring';
import type { LlmAnalysis, LlmFlag } from '../db/types';

// ============================================================================
// Analysis Endpoints
// ============================================================================

/**
 * POST /monitoring/analyze
 * Create a new analysis for a target
 */
export async function postAnalyze(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;

    // Validate input
    const parsed = CreateAnalysisSchema.safeParse(body);
    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const input = parsed.data;

    // Get target data (for now, expect it in request body)
    const targetData = body.target_data as Record<string, unknown> | undefined;
    if (!targetData) {
        return err(400, 'VALIDATION_ERROR', { message: 'target_data is required' });
    }

    try {
        const result = await runAnalysis(env, input, targetData, userId);

        return ok({
            analysis_id: result.analysis_id,
            status: result.status,
            risk_score: result.risk_score,
            risk_level: result.risk_level,
            recommendation: result.recommendation,
            summary: result.summary,
            flags_count: result.flags.length,
            agent_results: result.agent_results,
            tokens_used: result.tokens_used,
            processing_time_ms: result.processing_time_ms,
        }, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Analysis error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

/**
 * POST /monitoring/analyze/challenge
 * Analyze a specific challenge (convenience endpoint)
 */
export async function postAnalyzeChallenge(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;

    const parsed = AnalyzeTransactionSchema.safeParse(body);
    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const input = parsed.data;

    // Fetch challenge data from DB
    const challenge = await query<Record<string, unknown>>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges WHERE id = ?',
        [input.challenge_id]
    ).then(rows => rows[0]);

    if (!challenge) {
        return err(404, 'NOT_FOUND', { resource: 'challenge' });
    }

    // Combine challenge data with any additional transaction data
    const targetData = {
        ...challenge,
        ...input.transaction_data,
    };

    try {
        const result = await runAnalysis(
            env,
            {
                target_type: 'CHALLENGE',
                target_id: input.challenge_id,
                monitoring_mode: input.monitoring_mode,
                trigger_type: 'MANUAL',
            },
            targetData,
            userId
        );

        return ok({
            analysis_id: result.analysis_id,
            status: result.status,
            risk_score: result.risk_score,
            risk_level: result.risk_level,
            recommendation: result.recommendation,
            summary: result.summary,
            flags_count: result.flags.length,
        }, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Challenge analysis error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

/**
 * GET /monitoring/analyses/:id
 * Get analysis details
 */
export async function getAnalysisDetails(
    req: Request,
    env: Env,
    analysisId: string
): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const analysis = await getAnalysis(env, analysisId);
    if (!analysis) {
        return err(404, 'NOT_FOUND', { resource: 'analysis' });
    }

    // Check ownership (unless admin)
    if (analysis.requested_by_user_id && analysis.requested_by_user_id !== userId) {
        return err(403, 'FORBIDDEN');
    }

    const [flags, agentResults] = await Promise.all([
        getAnalysisFlags(env, analysisId),
        getAgentResults(env, analysisId),
    ]);

    return ok({
        ...analysis,
        flags,
        agent_results: agentResults,
    });
}

/**
 * GET /monitoring/analyses
 * List user's analyses
 */
export async function getListAnalyses(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const targetType = url.searchParams.get('target_type');
    const status = url.searchParams.get('status');

    let sql = `
        SELECT * FROM llm_analyses
        WHERE requested_by_user_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (targetType) {
        sql += ' AND target_type = ?';
        params.push(targetType);
    }

    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const analyses = await query<LlmAnalysis>(env.TATTLEHASH_DB, sql, params);

    return ok({
        analyses,
        pagination: { limit, offset, count: analyses.length },
    });
}

// ============================================================================
// Risk Score Endpoints
// ============================================================================

/**
 * GET /monitoring/risk/:entityType/:entityId
 * Get risk score for an entity
 */
export async function getRiskScoreEndpoint(
    req: Request,
    env: Env,
    entityType: string,
    entityId: string
): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    // Validate entity type
    const validTypes = ['USER', 'WALLET', 'CHALLENGE', 'TRANSACTION'];
    if (!validTypes.includes(entityType.toUpperCase())) {
        return err(400, 'VALIDATION_ERROR', {
            message: `Invalid entity type. Must be one of: ${validTypes.join(', ')}`,
        });
    }

    const url = new URL(req.url);
    const recalculate = url.searchParams.get('recalculate') === 'true';

    try {
        const result = await getRiskScore(env, {
            entity_type: entityType.toUpperCase() as 'USER' | 'WALLET' | 'CHALLENGE' | 'TRANSACTION',
            entity_id: entityId,
            recalculate,
        });

        return ok(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Risk score error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

/**
 * GET /monitoring/recommended-mode/:entityType/:entityId
 * Get recommended monitoring mode based on entity history
 */
export async function getRecommendedMode(
    req: Request,
    env: Env,
    entityType: string,
    entityId: string
): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    try {
        const mode = await getRecommendedMonitoringMode(env, entityType, entityId);

        return ok({
            entity_type: entityType,
            entity_id: entityId,
            recommended_mode: mode,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Recommended mode error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// URL Scanning Endpoints
// ============================================================================

/**
 * POST /monitoring/scan-url
 * Scan a single URL
 */
export async function postScanUrl(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const body = await req.json() as Record<string, unknown>;

    const parsed = ScanUrlSchema.safeParse(body);
    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    try {
        const result = await scanUrl(env, parsed.data);

        return ok({
            url: result.url,
            domain: result.domain,
            status: result.status,
            threat_type: result.threat_type,
            threat_score: result.threat_score,
            indicators: result.indicators,
            cached: result.cached,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('URL scan error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

/**
 * POST /monitoring/scan-urls
 * Batch scan multiple URLs
 */
export async function postScanUrls(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const body = await req.json() as Record<string, unknown>;
    const urls = body.urls as string[] | undefined;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return err(400, 'VALIDATION_ERROR', { message: 'urls array is required' });
    }

    if (urls.length > 50) {
        return err(400, 'VALIDATION_ERROR', { message: 'Maximum 50 URLs per request' });
    }

    try {
        const results = await scanUrls(env, urls);

        return ok({
            results,
            summary: {
                total: results.length,
                clean: results.filter(r => r.status === 'CLEAN').length,
                suspicious: results.filter(r => r.status === 'SUSPICIOUS').length,
                malicious: results.filter(r => r.status === 'MALICIOUS').length,
                errors: results.filter(r => r.status === 'ERROR').length,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Batch URL scan error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

/**
 * POST /monitoring/extract-urls
 * Extract and scan URLs from text
 */
export async function postExtractUrls(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const body = await req.json() as Record<string, unknown>;
    const text = body.text as string | undefined;
    const scanResults = body.scan !== false; // Default to true

    if (!text || typeof text !== 'string') {
        return err(400, 'VALIDATION_ERROR', { message: 'text is required' });
    }

    if (text.length > 100000) {
        return err(400, 'VALIDATION_ERROR', { message: 'Text too long (max 100KB)' });
    }

    const urls = extractUrls(text);

    if (!scanResults || urls.length === 0) {
        return ok({ urls, results: null });
    }

    // Limit URLs to scan
    const urlsToScan = urls.slice(0, 50);

    try {
        const results = await scanUrls(env, urlsToScan);

        return ok({
            urls,
            results,
            summary: {
                total: results.length,
                clean: results.filter(r => r.status === 'CLEAN').length,
                suspicious: results.filter(r => r.status === 'SUSPICIOUS').length,
                malicious: results.filter(r => r.status === 'MALICIOUS').length,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Extract URLs error:', message);
        return ok({ urls, results: null, error: message });
    }
}

// ============================================================================
// Flags Endpoints
// ============================================================================

/**
 * GET /monitoring/flags
 * List flags for user's analyses
 */
export async function getListFlags(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const severity = url.searchParams.get('severity');
    const resolved = url.searchParams.get('resolved');

    let sql = `
        SELECT f.* FROM llm_flags f
        JOIN llm_analyses a ON f.analysis_id = a.id
        WHERE a.requested_by_user_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (severity) {
        sql += ' AND f.severity = ?';
        params.push(severity.toUpperCase());
    }

    if (resolved !== null) {
        sql += ' AND f.resolved = ?';
        params.push(resolved === 'true' ? 1 : 0);
    }

    sql += ' ORDER BY f.severity DESC, f.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const flags = await query<LlmFlag>(env.TATTLEHASH_DB, sql, params);

    return ok({
        flags,
        pagination: { limit, offset, count: flags.length },
    });
}

/**
 * PATCH /monitoring/flags/:id/resolve
 * Resolve a flag
 */
export async function patchResolveFlag(
    req: Request,
    env: Env,
    flagId: string
): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;
    const resolutionNotes = body.resolution_notes as string | undefined;

    // Verify flag exists and user owns the analysis
    const flag = await query<LlmFlag & { requested_by_user_id: string }>(
        env.TATTLEHASH_DB,
        `SELECT f.*, a.requested_by_user_id FROM llm_flags f
         JOIN llm_analyses a ON f.analysis_id = a.id
         WHERE f.id = ?`,
        [flagId]
    ).then(rows => rows[0]);

    if (!flag) {
        return err(404, 'NOT_FOUND', { resource: 'flag' });
    }

    if (flag.requested_by_user_id !== userId) {
        return err(403, 'FORBIDDEN');
    }

    await query(
        env.TATTLEHASH_DB,
        `UPDATE llm_flags SET
            resolved = 1,
            resolved_by_user_id = ?,
            resolution_notes = ?,
            resolved_at = ?
         WHERE id = ?`,
        [userId, resolutionNotes ?? null, Date.now(), flagId]
    );

    return ok({ resolved: true, flag_id: flagId });
}
