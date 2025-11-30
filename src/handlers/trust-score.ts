/**
 * Trust Score HTTP Handlers
 *
 * Endpoints for wallet trust score assessment.
 */

import { ok, err, parseBody } from '../lib/http';
import { checkRateLimit } from '../middleware/ratelimit';
import type { Env } from '../types';
import {
    WalletAddressSchema,
    BatchTrustScoreRequestSchema,
    GetHistoryParamsSchema,
    getTrustScore,
    getBatchTrustScores,
    getTrustScoreHistory,
    TRUST_SCORE_DEFAULTS,
} from '../trust-score';

// ============================================================================
// GET /trust-score/:walletAddress - Get trust score for a wallet
// ============================================================================

export async function getTrustScoreHandler(
    req: Request,
    env: Env,
    walletAddress: string
): Promise<Response> {
    // Validate wallet address format
    const parseResult = WalletAddressSchema.safeParse(walletAddress);
    if (!parseResult.success) {
        return err(400, 'invalid_wallet_address', {
            message: 'Invalid Ethereum wallet address format',
            expected: '0x followed by 40 hexadecimal characters',
        });
    }

    // Parse query params
    const url = new URL(req.url);
    const skipCache = url.searchParams.get('skipCache') === 'true';

    try {
        const score = await getTrustScore(env, walletAddress, skipCache);
        return ok(score, {
            headers: {
                'Cache-Control': `public, max-age=${score.cacheTTL}`,
                'X-Trust-Score': score.trustScore.toString(),
                'X-Risk-Level': score.riskLevel,
            },
        });
    } catch (error) {
        console.error('Trust score calculation failed:', error);
        return err(500, 'calculation_failed', {
            message: 'Failed to calculate trust score',
        });
    }
}

// ============================================================================
// POST /trust-score/batch - Get trust scores for multiple wallets
// ============================================================================

export async function postBatchTrustScore(
    req: Request,
    env: Env
): Promise<Response> {
    // Parse and validate request body
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'invalid_json', { message: bodyResult.error });
    }

    const parseResult = BatchTrustScoreRequestSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'validation_error', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
            max_batch_size: TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE,
        });
    }

    const { wallets, skipCache } = parseResult.data;

    try {
        const result = await getBatchTrustScores(env, wallets, skipCache);
        return ok(result);
    } catch (error) {
        console.error('Batch trust score calculation failed:', error);
        return err(500, 'batch_calculation_failed', {
            message: 'Failed to calculate batch trust scores',
        });
    }
}

// ============================================================================
// GET /trust-score/:walletAddress/history - Get trust score history
// ============================================================================

export async function getTrustScoreHistoryHandler(
    req: Request,
    env: Env,
    walletAddress: string
): Promise<Response> {
    // Validate wallet address format
    const walletParse = WalletAddressSchema.safeParse(walletAddress);
    if (!walletParse.success) {
        return err(400, 'invalid_wallet_address', {
            message: 'Invalid Ethereum wallet address format',
        });
    }

    // Parse query params
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const sinceParam = url.searchParams.get('since');

    const paramsResult = GetHistoryParamsSchema.safeParse({
        limit: limitParam ? parseInt(limitParam, 10) : undefined,
        since: sinceParam || undefined,
    });

    if (!paramsResult.success) {
        return err(400, 'validation_error', {
            errors: paramsResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    const { limit, since } = paramsResult.data;

    try {
        const history = await getTrustScoreHistory(env, walletAddress, limit, since);
        return ok(history);
    } catch (error) {
        console.error('Trust score history fetch failed:', error);
        return err(500, 'history_fetch_failed', {
            message: 'Failed to retrieve trust score history',
        });
    }
}

// ============================================================================
// GET /trust-score/health - Health check for trust score service
// ============================================================================

export async function getTrustScoreHealth(
    _req: Request,
    _env: Env
): Promise<Response> {
    return ok({
        service: 'trust-score',
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        config: {
            cacheTTL: TRUST_SCORE_DEFAULTS.CACHE_TTL_SECONDS,
            maxBatchSize: TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE,
            historyLimit: TRUST_SCORE_DEFAULTS.HISTORY_LIMIT,
        },
        endpoints: [
            {
                method: 'GET',
                path: '/trust-score/:walletAddress',
                description: 'Get trust score for a wallet',
            },
            {
                method: 'POST',
                path: '/trust-score/batch',
                description: 'Get trust scores for multiple wallets',
            },
            {
                method: 'GET',
                path: '/trust-score/:walletAddress/history',
                description: 'Get trust score history',
            },
        ],
        riskLevels: {
            LOW: '70-100 (Green light)',
            MEDIUM: '40-69 (Yellow light)',
            HIGH: '0-39 (Red light)',
        },
    });
}

// ============================================================================
// GET /trust-score/thresholds - Get risk level thresholds
// ============================================================================

export async function getTrustScoreThresholds(
    _req: Request,
    _env: Env
): Promise<Response> {
    return ok({
        riskLevels: [
            {
                level: 'LOW',
                range: '70-100',
                indicator: 'GREEN',
                recommendation: 'Proceed with confidence',
                description: 'Wallet has strong trust indicators',
            },
            {
                level: 'MEDIUM',
                range: '40-69',
                indicator: 'YELLOW',
                recommendation: 'Proceed with caution',
                description: 'Some risk factors present, verify carefully',
            },
            {
                level: 'HIGH',
                range: '0-39',
                indicator: 'RED',
                recommendation: 'Not recommended to proceed',
                description: 'Significant risk factors detected',
            },
        ],
        factors: [
            { name: 'walletAge', weight: 0.20, description: 'How long the wallet has been active' },
            { name: 'transactionHistory', weight: 0.25, description: 'Number of TattleHash transactions' },
            { name: 'disputeRate', weight: 0.30, description: 'Percentage of disputed transactions' },
            { name: 'verificationStatus', weight: 0.15, description: 'Gatekeeper verification status' },
            { name: 'networkAnalysis', weight: 0.10, description: 'Connections to flagged wallets' },
        ],
        flags: [
            { type: 'WALLET_NEW', severity: 'WARNING', description: 'Less than 7 days old' },
            { type: 'LIMITED_HISTORY', severity: 'INFO', description: 'Fewer than 3 transactions' },
            { type: 'DISPUTE_HISTORY', severity: 'WARNING', description: 'Has disputed transactions' },
            { type: 'VERIFICATION_FAILED', severity: 'CRITICAL', description: 'Failed Gatekeeper verification' },
            { type: 'FLAGGED_CONNECTIONS', severity: 'WARNING', description: 'Transacted with flagged wallets' },
            { type: 'PATTERN_ANOMALY', severity: 'WARNING', description: 'Unusual transaction patterns' },
        ],
    });
}
