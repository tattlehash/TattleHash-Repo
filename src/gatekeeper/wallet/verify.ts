
import { queryOne, execute } from '../../db';
import { recoverAddressFromSignature } from './recovery';
import { createError } from '../../errors';
import { emitEvent } from '../../relay';
import { getOrCreateUser, generateToken } from '../../auth';
import type { WalletVerifyRequest, WalletVerifyResponse, TrustScoreSummary, WalletTrafficLight } from '../types';
import { Env } from '../../types';
import { getTrustScore, RISK_THRESHOLDS } from '../../trust-score';
import type { TrustScoreResponse } from '../../trust-score';

export async function verifyWalletSignature(
    env: Env,
    data: WalletVerifyRequest
): Promise<WalletVerifyResponse> {
    // Try to fetch from KV first (faster)
    const kvData = await env.GATE_KV.get(`wallet_challenge:${data.challenge_id}`);

    if (!kvData) {
        throw createError('WALLET_CHALLENGE_NOT_FOUND');
    }

    const challenge = JSON.parse(kvData);

    // Check expiry
    const now = Date.now();
    if (now > challenge.expires_at) {
        await env.GATE_KV.delete(`wallet_challenge:${data.challenge_id}`);
        throw createError('WALLET_CHALLENGE_EXPIRED');
    }

    // Recover address from signature
    let recoveredAddress: string;
    try {
        recoveredAddress = await recoverAddressFromSignature(
            challenge.message,
            data.signature
        );
    } catch (e) {
        console.error('Signature recovery failed:', e);
        throw createError('WALLET_INVALID_SIGNATURE');
    }

    // Compare addresses (both lowercase)
    const normalizedRecovered = recoveredAddress.toLowerCase();
    const normalizedExpected = challenge.wallet_address.toLowerCase();

    if (normalizedRecovered !== normalizedExpected) {
        throw createError('WALLET_INVALID_SIGNATURE', {
            recovered: normalizedRecovered,
            expected: normalizedExpected,
        });
    }

    // Success! Mark as used in D1
    const verifiedAt = new Date().toISOString();
    const usedAtTimestamp = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE wallet_challenges SET used_at = ? WHERE id = ?`,
        [usedAtTimestamp, data.challenge_id]
    );

    // Clean up KV
    await env.GATE_KV.delete(`wallet_challenge:${data.challenge_id}`);

    // Get or create user for this wallet
    const { user, created } = await getOrCreateUser(env, normalizedExpected);

    // Generate auth token
    const authToken = await generateToken(env, user.id, user.wallet_address);

    // Fetch Trust Score for the verified wallet
    const trustScoreResult = await fetchTrustScoreForWallet(env, normalizedExpected);

    // Calculate traffic light based on Trust Score + verification status (passed)
    const trafficLight = calculateWalletTrafficLight(trustScoreResult, true);
    const recommendation = getTrafficLightRecommendation(trafficLight);

    // Check for significant score changes and emit webhook
    await checkAndEmitScoreChange(env, normalizedExpected, trustScoreResult);

    // Create Trust Score summary for response
    const trustScoreSummary: TrustScoreSummary = {
        score: trustScoreResult.trustScore,
        riskLevel: trustScoreResult.riskLevel,
        flags: trustScoreResult.flags,
        confidence: trustScoreResult.confidence,
        lastUpdated: trustScoreResult.lastUpdated,
    };

    // Emit wallet.verified event with Trust Score data
    await emitEvent(env, {
        type: 'wallet.verified',
        wallet_address: normalizedExpected,
        verified_at: verifiedAt,
        user_id: user.id,
        user_created: created,
        trust_score: trustScoreResult.trustScore,
        risk_level: trustScoreResult.riskLevel,
        traffic_light: trafficLight,
    });

    return {
        status: 'VERIFIED',
        wallet_address: normalizedExpected,
        verified_at: verifiedAt,
        user_id: user.id,
        token: authToken.token,
        token_expires_at: authToken.expires_at,
        trust_score: trustScoreSummary,
        traffic_light: trafficLight,
        recommendation,
    };
}

// ============================================================================
// Trust Score Integration Helpers
// ============================================================================

/**
 * Fetch Trust Score for a wallet address.
 * Falls back to default score on error.
 */
async function fetchTrustScoreForWallet(
    env: Env,
    wallet: string
): Promise<TrustScoreResponse> {
    try {
        return await getTrustScore(env, wallet, false);
    } catch (error) {
        console.error('Trust score fetch failed for verification:', error);
        // Return conservative default score on error
        return createDefaultTrustScore(wallet);
    }
}

/**
 * Create a default Trust Score when calculation fails.
 * Uses conservative MEDIUM risk level.
 */
function createDefaultTrustScore(wallet: string): TrustScoreResponse {
    return {
        wallet,
        trustScore: 50, // Conservative middle score
        riskLevel: 'MEDIUM',
        factors: {
            walletAge: { value: 'unknown', score: 50, weight: 0.20, detail: 'Unable to determine wallet age' },
            transactionHistory: { value: 'unknown', score: 50, weight: 0.25, detail: 'Unable to fetch transaction history' },
            disputeRate: { value: 'unknown', score: 50, weight: 0.30, detail: 'Unable to calculate dispute rate' },
            verificationStatus: { value: 'verified', score: 100, weight: 0.15, detail: 'Wallet just verified' },
            networkAnalysis: { value: 'unknown', score: 50, weight: 0.10, detail: 'Unable to analyze network' },
        },
        flags: [],
        confidence: 0.3, // Low confidence due to missing data
        lastUpdated: new Date().toISOString(),
        cacheTTL: 300, // Short cache for default scores
    };
}

/**
 * Calculate traffic light based on Trust Score and verification status.
 *
 * Rules:
 * - Score 70-100 + verification passed → GREEN
 * - Score 40-69 OR minor issues → YELLOW
 * - Score 0-39 OR verification failed → RED
 */
export function calculateWalletTrafficLight(
    trustScore: TrustScoreResponse,
    verificationPassed: boolean
): WalletTrafficLight {
    // Verification failed → RED
    if (!verificationPassed) {
        return 'RED';
    }

    // Check for critical flags → RED
    const hasCriticalFlag = trustScore.flags.some(f => f.severity === 'CRITICAL');
    if (hasCriticalFlag) {
        return 'RED';
    }

    // HIGH risk (0-39) → RED
    if (trustScore.riskLevel === 'HIGH') {
        return 'RED';
    }

    // LOW risk (70-100) with no critical flags → GREEN
    if (trustScore.riskLevel === 'LOW') {
        return 'GREEN';
    }

    // MEDIUM risk (40-69) or any other case → YELLOW
    return 'YELLOW';
}

/**
 * Get human-readable recommendation based on traffic light state.
 */
function getTrafficLightRecommendation(state: WalletTrafficLight): string {
    switch (state) {
        case 'GREEN':
            return 'Wallet verified with strong trust indicators. Proceed with confidence.';
        case 'YELLOW':
            return 'Wallet verified but some risk factors present. Proceed with caution and verify transaction details.';
        case 'RED':
            return 'Significant risk factors detected. Not recommended to proceed without additional verification.';
    }
}

/**
 * Check for significant Trust Score changes and emit webhook event.
 * Significant change: 10+ points or risk level change.
 */
async function checkAndEmitScoreChange(
    env: Env,
    wallet: string,
    currentScore: TrustScoreResponse
): Promise<void> {
    const cacheKey = `trust_score_prev:${wallet.toLowerCase()}`;

    try {
        const prevData = await env.GATE_KV.get(cacheKey);

        if (prevData) {
            const prev = JSON.parse(prevData) as { score: number; riskLevel: string };
            const scoreDelta = currentScore.trustScore - prev.score;
            const riskLevelChanged = currentScore.riskLevel !== prev.riskLevel;

            // Emit event on significant change
            if (Math.abs(scoreDelta) >= 10 || riskLevelChanged) {
                await emitEvent(env, {
                    type: 'trust_score.changed',
                    wallet_address: wallet,
                    previous_score: prev.score,
                    current_score: currentScore.trustScore,
                    score_delta: scoreDelta,
                    previous_risk_level: prev.riskLevel,
                    current_risk_level: currentScore.riskLevel,
                    risk_level_changed: riskLevelChanged,
                    flags_count: currentScore.flags.length,
                    confidence: currentScore.confidence,
                    changed_at: new Date().toISOString(),
                });
            }
        }

        // Store current score for future comparison
        await env.GATE_KV.put(
            cacheKey,
            JSON.stringify({
                score: currentScore.trustScore,
                riskLevel: currentScore.riskLevel,
            }),
            { expirationTtl: 86400 } // 24 hours
        );
    } catch (error) {
        // Non-critical - log and continue
        console.error('Trust score change check failed:', error);
    }
}
