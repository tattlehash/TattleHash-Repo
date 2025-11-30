/**
 * Trust Score Service
 *
 * Core logic for calculating wallet trust scores.
 */

import { query, queryOne } from '../db';
import type { Env } from '../types';
import {
    TRUST_SCORE_DEFAULTS,
    RISK_THRESHOLDS,
    FACTOR_WEIGHTS,
    FLAG_DEFINITIONS,
    type RiskLevel,
    type FlagType,
    type TriggerReason,
    type ScoreFactors,
    type TrustFlag,
    type TrustScoreResponse,
    type TrustScoreHistoryResponse,
    type TrustScoreHistoryItem,
    type TrustScoreRecord,
    type TrustScoreHistoryRecord,
    type WalletFlagRecord,
    type WalletStatsRecord,
} from './types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize wallet address to lowercase for consistent lookups.
 */
export function normalizeWallet(address: string): string {
    return address.toLowerCase();
}

/**
 * Calculate risk level from trust score.
 */
export function getRiskLevel(score: number): RiskLevel {
    if (score >= RISK_THRESHOLDS.LOW_MIN) return 'LOW';
    if (score >= RISK_THRESHOLDS.MEDIUM_MIN) return 'MEDIUM';
    return 'HIGH';
}

/**
 * Format duration for display.
 */
function formatDuration(ms: number): string {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days === 0) return 'Less than 1 day';
    if (days === 1) return '1 day';
    if (days < 30) return `${days} days`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year' : `${years} years`;
}

/**
 * Generate cache key for KV storage.
 */
export function getCacheKey(wallet: string): string {
    return `trust_score:${normalizeWallet(wallet)}`;
}

// ============================================================================
// Data Collection
// ============================================================================

/**
 * Get or create wallet stats from database.
 */
async function getWalletStats(
    env: Env,
    wallet: string
): Promise<WalletStatsRecord | null> {
    const walletLower = normalizeWallet(wallet);

    // Try to get existing stats
    const stats = await queryOne<WalletStatsRecord>(
        env.TATTLEHASH_DB,
        'SELECT * FROM wallet_stats WHERE wallet_address_lower = ?',
        [walletLower]
    );

    return stats;
}

/**
 * Get active flags for a wallet.
 */
async function getActiveFlags(
    env: Env,
    wallet: string
): Promise<WalletFlagRecord[]> {
    const walletLower = normalizeWallet(wallet);

    const flags = await query<WalletFlagRecord>(
        env.TATTLEHASH_DB,
        'SELECT * FROM wallet_flags WHERE wallet_address_lower = ? AND active = 1 ORDER BY severity DESC, created_at DESC',
        [walletLower]
    );

    return flags;
}

/**
 * Count transactions from challenges and ENF bundles.
 */
async function countTransactions(
    env: Env,
    wallet: string
): Promise<number> {
    const walletLower = normalizeWallet(wallet);

    // Count challenges where wallet is creator or counterparty
    const challengeCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM challenges
         WHERE LOWER(creator_wallet) = ? OR LOWER(counterparty_wallet) = ?`,
        [walletLower, walletLower]
    );

    // Count ENF recipients
    const enfCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM enf_recipients
         WHERE LOWER(recipient_value) = ? AND recipient_type = 'WALLET'`,
        [walletLower]
    );

    return (challengeCount?.count || 0) + (enfCount?.count || 0);
}

/**
 * Calculate dispute rate for a wallet.
 */
async function getDisputeStats(
    env: Env,
    wallet: string
): Promise<{ raised: number; received: number; total: number }> {
    const walletLower = normalizeWallet(wallet);

    // Get dispute counts
    const raised = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM disputes
         WHERE LOWER(raised_by_wallet) = ?`,
        [walletLower]
    );

    const received = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM disputes
         WHERE LOWER(against_wallet) = ?`,
        [walletLower]
    );

    const total = await countTransactions(env, wallet);

    return {
        raised: raised?.count || 0,
        received: received?.count || 0,
        total,
    };
}

/**
 * Check Gatekeeper verification status.
 */
async function getVerificationStatus(
    env: Env,
    wallet: string
): Promise<{ verified: boolean; verificationCount: number; lastStatus: string | null }> {
    const walletLower = normalizeWallet(wallet);

    // Check KV for recent verification
    const kvKey = `gk:wallet:${walletLower}`;
    const verification = await env.GATE_KV?.get(kvKey);

    if (verification) {
        const data = JSON.parse(verification);
        return {
            verified: data.verified === true,
            verificationCount: data.count || 1,
            lastStatus: data.verified ? 'PASSED' : 'FAILED',
        };
    }

    return {
        verified: false,
        verificationCount: 0,
        lastStatus: null,
    };
}

/**
 * Analyze network connections for flagged wallets.
 */
async function analyzeNetwork(
    env: Env,
    wallet: string
): Promise<{ flaggedConnections: number; totalConnections: number }> {
    const walletLower = normalizeWallet(wallet);

    // Get counterparties from challenges
    const counterparties = await query<{ wallet: string }>(
        env.TATTLEHASH_DB,
        `SELECT DISTINCT
           CASE
             WHEN LOWER(creator_wallet) = ? THEN counterparty_wallet
             ELSE creator_wallet
           END as wallet
         FROM challenges
         WHERE LOWER(creator_wallet) = ? OR LOWER(counterparty_wallet) = ?`,
        [walletLower, walletLower, walletLower]
    );

    const totalConnections = counterparties.length;
    let flaggedConnections = 0;

    // Check each counterparty for flags
    for (const cp of counterparties) {
        if (!cp.wallet) continue;
        const cpLower = cp.wallet.toLowerCase();
        const flags = await queryOne<{ count: number }>(
            env.TATTLEHASH_DB,
            'SELECT COUNT(*) as count FROM wallet_flags WHERE wallet_address_lower = ? AND active = 1 AND severity = ?',
            [cpLower, 'CRITICAL']
        );
        if (flags && flags.count > 0) {
            flaggedConnections++;
        }
    }

    return { flaggedConnections, totalConnections };
}

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate individual factor scores.
 */
async function calculateFactors(
    env: Env,
    wallet: string
): Promise<{ factors: ScoreFactors; dataPoints: number }> {
    const now = Date.now();
    let dataPoints = 0;

    // 1. Wallet Age
    const walletLower = normalizeWallet(wallet);
    const firstSeen = await queryOne<{ first_seen: number }>(
        env.TATTLEHASH_DB,
        `SELECT MIN(created_at) as first_seen FROM (
           SELECT created_at FROM challenges WHERE LOWER(creator_wallet) = ? OR LOWER(counterparty_wallet) = ?
           UNION ALL
           SELECT b.created_at FROM enf_bundles b
           JOIN enf_recipients r ON b.id = r.bundle_id
           WHERE LOWER(r.recipient_value) = ? AND r.recipient_type = 'WALLET'
         )`,
        [walletLower, walletLower, walletLower]
    );

    const walletAgeMs = firstSeen?.first_seen ? now - firstSeen.first_seen : 0;
    const walletAgeDays = Math.floor(walletAgeMs / (24 * 60 * 60 * 1000));

    let walletAgeScore: number;
    let walletAgeDetail: string;
    if (walletAgeDays === 0) {
        walletAgeScore = 30;
        walletAgeDetail = 'New wallet, no history';
    } else if (walletAgeDays < 7) {
        walletAgeScore = 40;
        walletAgeDetail = 'Wallet created very recently';
    } else if (walletAgeDays < 30) {
        walletAgeScore = 60;
        walletAgeDetail = 'Wallet created recently';
    } else if (walletAgeDays < 90) {
        walletAgeScore = 75;
        walletAgeDetail = 'Established wallet';
    } else if (walletAgeDays < 365) {
        walletAgeScore = 85;
        walletAgeDetail = 'Well-established wallet';
    } else {
        walletAgeScore = 95;
        walletAgeDetail = 'Long-standing wallet';
    }
    if (firstSeen?.first_seen) dataPoints++;

    // 2. Transaction History
    const txCount = await countTransactions(env, wallet);
    let txScore: number;
    let txDetail: string;
    if (txCount === 0) {
        txScore = 30;
        txDetail = 'No transaction history';
    } else if (txCount < 3) {
        txScore = 50;
        txDetail = 'Limited history';
    } else if (txCount < 10) {
        txScore = 70;
        txDetail = 'Moderate history';
    } else if (txCount < 50) {
        txScore = 85;
        txDetail = 'Good transaction history';
    } else {
        txScore = 95;
        txDetail = 'Extensive transaction history';
    }
    dataPoints++;

    // 3. Dispute Rate
    const disputeStats = await getDisputeStats(env, wallet);
    const disputeRate = disputeStats.total > 0
        ? ((disputeStats.raised + disputeStats.received) / disputeStats.total) * 100
        : 0;

    let disputeScore: number;
    let disputeDetail: string;
    if (disputeRate === 0) {
        disputeScore = 100;
        disputeDetail = 'No disputes on record';
    } else if (disputeRate < 5) {
        disputeScore = 85;
        disputeDetail = 'Very low dispute rate';
    } else if (disputeRate < 15) {
        disputeScore = 65;
        disputeDetail = 'Moderate dispute rate';
    } else if (disputeRate < 30) {
        disputeScore = 40;
        disputeDetail = 'High dispute rate';
    } else {
        disputeScore = 20;
        disputeDetail = 'Very high dispute rate';
    }
    dataPoints++;

    // 4. Verification Status
    const verification = await getVerificationStatus(env, wallet);
    let verificationScore: number;
    let verificationDetail: string;
    if (verification.verified) {
        verificationScore = 90;
        verificationDetail = 'Gatekeeper verified';
    } else if (verification.lastStatus === 'FAILED') {
        verificationScore = 30;
        verificationDetail = 'Failed verification';
    } else {
        verificationScore = 50;
        verificationDetail = 'Not verified';
    }
    if (verification.lastStatus) dataPoints++;

    // 5. Network Analysis
    const network = await analyzeNetwork(env, wallet);
    let networkScore: number;
    let networkDetail: string;
    if (network.totalConnections === 0) {
        networkScore = 50;
        networkDetail = 'No network connections';
    } else if (network.flaggedConnections === 0) {
        networkScore = 90;
        networkDetail = 'Clean network';
    } else {
        const flaggedRatio = network.flaggedConnections / network.totalConnections;
        if (flaggedRatio < 0.1) {
            networkScore = 70;
            networkDetail = 'Minor flagged connections';
        } else if (flaggedRatio < 0.3) {
            networkScore = 45;
            networkDetail = 'Some flagged connections';
        } else {
            networkScore = 20;
            networkDetail = 'Many flagged connections';
        }
    }
    if (network.totalConnections > 0) dataPoints++;

    const factors: ScoreFactors = {
        walletAge: {
            value: walletAgeDays > 0 ? formatDuration(walletAgeMs) : 'Unknown',
            score: walletAgeScore,
            weight: FACTOR_WEIGHTS.walletAge,
            detail: walletAgeDetail,
        },
        transactionHistory: {
            value: `${txCount} transactions`,
            score: txScore,
            weight: FACTOR_WEIGHTS.transactionHistory,
            detail: txDetail,
        },
        disputeRate: {
            value: `${disputeRate.toFixed(0)}%`,
            score: disputeScore,
            weight: FACTOR_WEIGHTS.disputeRate,
            detail: disputeDetail,
        },
        verificationStatus: {
            value: verification.verified ? 'Gatekeeper verified' : 'Not verified',
            score: verificationScore,
            weight: FACTOR_WEIGHTS.verificationStatus,
            detail: verificationDetail,
        },
        networkAnalysis: {
            value: network.flaggedConnections > 0
                ? `${network.flaggedConnections} flagged connections`
                : 'No flagged connections',
            score: networkScore,
            weight: FACTOR_WEIGHTS.networkAnalysis,
            detail: networkDetail,
        },
    };

    return { factors, dataPoints };
}

/**
 * Generate flags based on wallet data.
 */
async function generateFlags(
    env: Env,
    wallet: string,
    factors: ScoreFactors
): Promise<TrustFlag[]> {
    const flags: TrustFlag[] = [];
    const now = new Date().toISOString();

    // Check for system-generated flags
    const walletAgeDays = parseInt(factors.walletAge.value) || 0;
    if (factors.walletAge.value === 'Unknown' || walletAgeDays < 7) {
        flags.push({
            type: 'WALLET_NEW',
            severity: FLAG_DEFINITIONS.WALLET_NEW.severity,
            description: FLAG_DEFINITIONS.WALLET_NEW.description,
            detectedAt: now,
        });
    }

    const txCount = parseInt(factors.transactionHistory.value) || 0;
    if (txCount < 3) {
        flags.push({
            type: 'LIMITED_HISTORY',
            severity: FLAG_DEFINITIONS.LIMITED_HISTORY.severity,
            description: FLAG_DEFINITIONS.LIMITED_HISTORY.description,
            detectedAt: now,
        });
    }

    const disputeRate = parseFloat(factors.disputeRate.value) || 0;
    if (disputeRate > 0) {
        flags.push({
            type: 'DISPUTE_HISTORY',
            severity: FLAG_DEFINITIONS.DISPUTE_HISTORY.severity,
            description: FLAG_DEFINITIONS.DISPUTE_HISTORY.description,
            detectedAt: now,
            evidence: { rate: disputeRate },
        });
    }

    if (factors.verificationStatus.value === 'Failed verification') {
        flags.push({
            type: 'VERIFICATION_FAILED',
            severity: FLAG_DEFINITIONS.VERIFICATION_FAILED.severity,
            description: FLAG_DEFINITIONS.VERIFICATION_FAILED.description,
            detectedAt: now,
        });
    }

    if (factors.networkAnalysis.value.includes('flagged')) {
        flags.push({
            type: 'FLAGGED_CONNECTIONS',
            severity: FLAG_DEFINITIONS.FLAGGED_CONNECTIONS.severity,
            description: FLAG_DEFINITIONS.FLAGGED_CONNECTIONS.description,
            detectedAt: now,
        });
    }

    // Get stored flags from database
    const dbFlags = await getActiveFlags(env, wallet);
    for (const dbFlag of dbFlags) {
        // Avoid duplicating system flags
        if (!flags.find(f => f.type === dbFlag.flag_type)) {
            flags.push({
                type: dbFlag.flag_type,
                severity: dbFlag.severity as 'INFO' | 'WARNING' | 'CRITICAL',
                description: dbFlag.description,
                detectedAt: new Date(dbFlag.created_at).toISOString(),
                evidence: dbFlag.evidence ? JSON.parse(dbFlag.evidence) : undefined,
            });
        }
    }

    return flags;
}

/**
 * Calculate final trust score from factors.
 */
function calculateFinalScore(factors: ScoreFactors): number {
    let weightedSum = 0;

    weightedSum += factors.walletAge.score * factors.walletAge.weight;
    weightedSum += factors.transactionHistory.score * factors.transactionHistory.weight;
    weightedSum += factors.disputeRate.score * factors.disputeRate.weight;
    weightedSum += factors.verificationStatus.score * factors.verificationStatus.weight;
    weightedSum += factors.networkAnalysis.score * factors.networkAnalysis.weight;

    return Math.round(weightedSum);
}

/**
 * Calculate confidence based on data availability.
 */
function calculateConfidence(dataPoints: number, totalDataPoints: number = 5): number {
    // Base confidence from data availability
    const dataConfidence = dataPoints / totalDataPoints;

    // Minimum confidence is 0.3 (we always have some info)
    return Math.max(0.3, Math.min(1.0, dataConfidence));
}

// ============================================================================
// Main API Functions
// ============================================================================

/**
 * Get trust score for a wallet address.
 */
export async function getTrustScore(
    env: Env,
    wallet: string,
    skipCache: boolean = false
): Promise<TrustScoreResponse> {
    const walletLower = normalizeWallet(wallet);
    const now = Date.now();

    // Check cache first (unless skipping)
    if (!skipCache) {
        const cacheKey = getCacheKey(wallet);
        const cached = await env.TATTLEHASH_KV.get(cacheKey);
        if (cached) {
            const cachedScore = JSON.parse(cached) as TrustScoreResponse;
            return cachedScore;
        }

        // Check database for unexpired score
        const dbScore = await queryOne<TrustScoreRecord>(
            env.TATTLEHASH_DB,
            'SELECT * FROM trust_scores WHERE wallet_address_lower = ? AND expires_at > ?',
            [walletLower, now]
        );

        if (dbScore) {
            const response: TrustScoreResponse = {
                wallet: dbScore.wallet_address,
                trustScore: dbScore.trust_score,
                riskLevel: dbScore.risk_level,
                factors: JSON.parse(dbScore.factors),
                flags: dbScore.flags ? JSON.parse(dbScore.flags) : [],
                confidence: dbScore.confidence,
                lastUpdated: new Date(dbScore.last_calculated_at).toISOString(),
                cacheTTL: dbScore.cache_ttl,
            };

            // Cache in KV for faster subsequent lookups
            await env.TATTLEHASH_KV.put(
                cacheKey,
                JSON.stringify(response),
                { expirationTtl: dbScore.cache_ttl }
            );

            return response;
        }
    }

    // Calculate fresh score
    const { factors, dataPoints } = await calculateFactors(env, wallet);
    const flags = await generateFlags(env, wallet, factors);
    const trustScore = calculateFinalScore(factors);
    const riskLevel = getRiskLevel(trustScore);
    const confidence = calculateConfidence(dataPoints);
    const cacheTTL = TRUST_SCORE_DEFAULTS.CACHE_TTL_SECONDS;
    const expiresAt = now + (cacheTTL * 1000);

    const response: TrustScoreResponse = {
        wallet,
        trustScore,
        riskLevel,
        factors,
        flags,
        confidence,
        lastUpdated: new Date(now).toISOString(),
        cacheTTL,
    };

    // Store in database
    const scoreId = crypto.randomUUID();
    const existingScore = await queryOne<TrustScoreRecord>(
        env.TATTLEHASH_DB,
        'SELECT id, first_seen_at FROM trust_scores WHERE wallet_address_lower = ?',
        [walletLower]
    );

    if (existingScore) {
        // Update existing record
        await env.TATTLEHASH_DB.prepare(`
            UPDATE trust_scores SET
                trust_score = ?,
                risk_level = ?,
                confidence = ?,
                factors = ?,
                flags = ?,
                data_points_available = ?,
                expires_at = ?,
                last_updated_at = ?,
                last_calculated_at = ?
            WHERE wallet_address_lower = ?
        `).bind(
            trustScore,
            riskLevel,
            confidence,
            JSON.stringify(factors),
            JSON.stringify(flags),
            dataPoints,
            expiresAt,
            now,
            now,
            walletLower
        ).run();

        // Record history
        await env.TATTLEHASH_DB.prepare(`
            INSERT INTO trust_score_history (
                id, wallet_address, trust_score_id, trust_score, risk_level,
                confidence, factors, flags, trigger_reason, calculated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            crypto.randomUUID(),
            wallet,
            existingScore.id,
            trustScore,
            riskLevel,
            confidence,
            JSON.stringify(factors),
            JSON.stringify(flags),
            skipCache ? 'MANUAL' : 'CACHE_EXPIRED',
            now
        ).run();
    } else {
        // Insert new record
        await env.TATTLEHASH_DB.prepare(`
            INSERT INTO trust_scores (
                id, wallet_address, wallet_address_lower, trust_score, risk_level,
                confidence, factors, flags, data_points_available, data_points_total,
                cache_ttl, expires_at, first_seen_at, last_updated_at, last_calculated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            scoreId,
            wallet,
            walletLower,
            trustScore,
            riskLevel,
            confidence,
            JSON.stringify(factors),
            JSON.stringify(flags),
            dataPoints,
            5,
            cacheTTL,
            expiresAt,
            now,
            now,
            now
        ).run();

        // Record initial history
        await env.TATTLEHASH_DB.prepare(`
            INSERT INTO trust_score_history (
                id, wallet_address, trust_score_id, trust_score, risk_level,
                confidence, factors, flags, trigger_reason, calculated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            crypto.randomUUID(),
            wallet,
            scoreId,
            trustScore,
            riskLevel,
            confidence,
            JSON.stringify(factors),
            JSON.stringify(flags),
            'INITIAL',
            now
        ).run();
    }

    // Cache in KV
    const cacheKey = getCacheKey(wallet);
    await env.TATTLEHASH_KV.put(
        cacheKey,
        JSON.stringify(response),
        { expirationTtl: cacheTTL }
    );

    return response;
}

/**
 * Get trust scores for multiple wallets (batch).
 */
export async function getBatchTrustScores(
    env: Env,
    wallets: string[],
    skipCache: boolean = false
): Promise<{
    results: TrustScoreResponse[];
    errors: Array<{ wallet: string; error: string }>;
    cached: number;
    calculated: number;
}> {
    const results: TrustScoreResponse[] = [];
    const errors: Array<{ wallet: string; error: string }> = [];
    let cached = 0;
    let calculated = 0;

    for (const wallet of wallets) {
        try {
            // Check cache first
            if (!skipCache) {
                const cacheKey = getCacheKey(wallet);
                const cachedResult = await env.TATTLEHASH_KV.get(cacheKey);
                if (cachedResult) {
                    results.push(JSON.parse(cachedResult));
                    cached++;
                    continue;
                }
            }

            const score = await getTrustScore(env, wallet, skipCache);
            results.push(score);
            calculated++;
        } catch (error) {
            errors.push({
                wallet,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    return { results, errors, cached, calculated };
}

/**
 * Get trust score history for a wallet.
 */
export async function getTrustScoreHistory(
    env: Env,
    wallet: string,
    limit: number = 50,
    since?: string
): Promise<TrustScoreHistoryResponse> {
    const walletLower = normalizeWallet(wallet);

    // Get current score first
    const currentScore = await getTrustScore(env, wallet);

    // Build query
    let historyQuery = `
        SELECT * FROM trust_score_history
        WHERE wallet_address = ?
    `;
    const params: (string | number)[] = [wallet];

    if (since) {
        historyQuery += ' AND calculated_at > ?';
        params.push(new Date(since).getTime());
    }

    historyQuery += ' ORDER BY calculated_at DESC LIMIT ?';
    params.push(limit);

    const historyRecords = await query<TrustScoreHistoryRecord>(
        env.TATTLEHASH_DB,
        historyQuery,
        params
    );

    const history: TrustScoreHistoryItem[] = historyRecords.map(r => ({
        trustScore: r.trust_score,
        riskLevel: r.risk_level,
        confidence: r.confidence,
        calculatedAt: new Date(r.calculated_at).toISOString(),
        triggerReason: r.trigger_reason,
    }));

    // Calculate trend
    let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' = 'STABLE';
    if (history.length >= 2) {
        const recent = history.slice(0, Math.min(5, history.length));
        const avgRecent = recent.reduce((sum, h) => sum + h.trustScore, 0) / recent.length;
        const older = history.slice(Math.min(5, history.length));
        if (older.length > 0) {
            const avgOlder = older.reduce((sum, h) => sum + h.trustScore, 0) / older.length;
            const diff = avgRecent - avgOlder;
            if (diff > 5) trend = 'IMPROVING';
            else if (diff < -5) trend = 'DECLINING';
        }
    }

    return {
        wallet,
        currentScore: currentScore.trustScore,
        history,
        trend,
        oldestRecord: history.length > 0 ? history[history.length - 1].calculatedAt : undefined,
        newestRecord: history.length > 0 ? history[0].calculatedAt : undefined,
    };
}

/**
 * Invalidate trust score cache for a wallet.
 * Call this when underlying data changes (new transaction, dispute, etc.)
 */
export async function invalidateTrustScore(
    env: Env,
    wallet: string,
    reason: TriggerReason
): Promise<void> {
    const walletLower = normalizeWallet(wallet);
    const cacheKey = getCacheKey(wallet);

    // Delete from KV cache
    await env.TATTLEHASH_KV.delete(cacheKey);

    // Mark database record as expired
    await env.TATTLEHASH_DB.prepare(`
        UPDATE trust_scores SET expires_at = 0 WHERE wallet_address_lower = ?
    `).bind(walletLower).run();

    // Optionally trigger recalculation
    // (or let it be lazy-calculated on next request)
}

/**
 * Add a flag to a wallet.
 */
export async function addWalletFlag(
    env: Env,
    wallet: string,
    flagType: FlagType,
    description: string,
    source: 'SYSTEM' | 'USER_REPORT' | 'LLM_ANALYSIS' | 'EXTERNAL' | 'ADMIN',
    reportedBy?: string,
    evidence?: Record<string, unknown>
): Promise<string> {
    const now = Date.now();
    const flagId = crypto.randomUUID();
    const walletLower = normalizeWallet(wallet);
    const severity = FLAG_DEFINITIONS[flagType]?.severity || 'INFO';

    await env.TATTLEHASH_DB.prepare(`
        INSERT INTO wallet_flags (
            id, wallet_address, wallet_address_lower, flag_type, severity,
            description, evidence, source, reported_by_user_id, active,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
        flagId,
        wallet,
        walletLower,
        flagType,
        severity,
        description,
        evidence ? JSON.stringify(evidence) : null,
        source,
        reportedBy || null,
        now,
        now
    ).run();

    // Invalidate cache
    await invalidateTrustScore(env, wallet, 'FLAG_CHANGE');

    return flagId;
}

/**
 * Resolve a flag on a wallet.
 */
export async function resolveWalletFlag(
    env: Env,
    flagId: string,
    resolvedBy: string,
    notes?: string
): Promise<boolean> {
    const now = Date.now();

    const flag = await queryOne<WalletFlagRecord>(
        env.TATTLEHASH_DB,
        'SELECT wallet_address FROM wallet_flags WHERE id = ?',
        [flagId]
    );

    if (!flag) return false;

    await env.TATTLEHASH_DB.prepare(`
        UPDATE wallet_flags SET
            active = 0,
            resolved_at = ?,
            resolved_by_user_id = ?,
            resolution_notes = ?,
            updated_at = ?
        WHERE id = ?
    `).bind(now, resolvedBy, notes || null, now, flagId).run();

    // Invalidate cache
    await invalidateTrustScore(env, flag.wallet_address, 'FLAG_CHANGE');

    return true;
}
