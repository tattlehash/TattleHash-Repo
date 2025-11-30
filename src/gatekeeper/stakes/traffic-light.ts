/**
 * Traffic Light State Calculation
 *
 * Evaluates the safety status of an ENFORCED mode transaction.
 *
 * States:
 * - GREEN:  Both parties verified, funds confirmed, safe to proceed
 * - YELLOW: Partial verification, some flags - proceed with caution
 * - RED:    Verification failed or threshold not met - do not proceed
 */

import { execute, queryOne, query } from '../../db';
import { Env } from '../../types';
import { getChallengeById } from '../challenges/create';
import type { Challenge } from '../challenges/types';
import type {
    Stake,
    EnforcedThreshold,
    TrafficLightState,
    TrafficLightEvaluation,
    StakeVerification,
    TrafficLightRecord,
} from './types';
import {
    getStakesByChallenge,
    getThresholdByChallenge,
    validateStakeAmount,
} from './core';
import { getTrustScore, RISK_THRESHOLDS } from '../../trust-score';
import type { TrustScoreResponse, RiskLevel } from '../../trust-score';

/**
 * Trust Score summary for traffic light evaluation
 */
interface PartyTrustScore {
    wallet: string;
    score: number;
    riskLevel: RiskLevel;
    hasCriticalFlags: boolean;
    confidence: number;
}

// ============================================================================
// Traffic Light Evaluation
// ============================================================================

export async function evaluateTrafficLight(
    env: Env,
    challengeId: string
): Promise<TrafficLightEvaluation> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        return createRedEvaluation('Challenge not found', []);
    }

    if (challenge.mode !== 'ENFORCED') {
        return createRedEvaluation('Not an ENFORCED mode challenge', []);
    }

    const threshold = await getThresholdByChallenge(env, challengeId);
    if (!threshold) {
        return createRedEvaluation('No threshold configuration found', []);
    }

    const stakes = await getStakesByChallenge(env, challengeId);
    const creatorStake = stakes.find(s => s.user_id === challenge.creator_user_id);
    const counterpartyStake = stakes.find(s => s.user_id === challenge.counterparty_user_id);

    // Evaluate stake components
    const creatorVerification = evaluateStake(
        creatorStake ?? null,
        threshold.creator_stake_required,
        threshold.required_confirmations
    );

    const counterpartyVerification = evaluateStake(
        counterpartyStake ?? null,
        threshold.counterparty_stake_required,
        threshold.required_confirmations
    );

    // Fetch wallet addresses for both parties via user lookup
    const [creatorWallet, counterpartyWallet] = await Promise.all([
        getUserWallet(env, challenge.creator_user_id),
        challenge.counterparty_user_id
            ? getUserWallet(env, challenge.counterparty_user_id)
            : null,
    ]);

    // Fetch Trust Scores for both parties
    const [creatorTrustScore, counterpartyTrustScore] = await Promise.all([
        creatorWallet ? fetchPartyTrustScore(env, creatorWallet) : null,
        counterpartyWallet ? fetchPartyTrustScore(env, counterpartyWallet) : null,
    ]);

    // Check time constraints
    const timeRemaining = threshold.deal_expiry_at
        ? Math.max(0, new Date(threshold.deal_expiry_at).getTime() - Date.now()) / 1000
        : null;

    const flags: string[] = [];

    // Collect stake flags
    if (creatorVerification.status === 'PENDING') {
        flags.push('Creator stake pending confirmation');
    }
    if (creatorVerification.status === 'INSUFFICIENT') {
        flags.push('Creator stake insufficient');
    }
    if (counterpartyVerification.status === 'PENDING') {
        flags.push('Counterparty stake pending confirmation');
    }
    if (counterpartyVerification.status === 'INSUFFICIENT') {
        flags.push('Counterparty stake insufficient');
    }
    if (timeRemaining !== null && timeRemaining < 3600) {
        flags.push('Less than 1 hour until deal expiry');
    }
    if (timeRemaining !== null && timeRemaining <= 0) {
        flags.push('Deal has expired');
    }

    // Collect Trust Score flags
    if (creatorTrustScore) {
        if (creatorTrustScore.riskLevel === 'HIGH') {
            flags.push(`Creator wallet has HIGH risk score (${creatorTrustScore.score})`);
        } else if (creatorTrustScore.riskLevel === 'MEDIUM') {
            flags.push(`Creator wallet has MEDIUM risk score (${creatorTrustScore.score})`);
        }
        if (creatorTrustScore.hasCriticalFlags) {
            flags.push('Creator wallet has CRITICAL trust flags');
        }
    }
    if (counterpartyTrustScore) {
        if (counterpartyTrustScore.riskLevel === 'HIGH') {
            flags.push(`Counterparty wallet has HIGH risk score (${counterpartyTrustScore.score})`);
        } else if (counterpartyTrustScore.riskLevel === 'MEDIUM') {
            flags.push(`Counterparty wallet has MEDIUM risk score (${counterpartyTrustScore.score})`);
        }
        if (counterpartyTrustScore.hasCriticalFlags) {
            flags.push('Counterparty wallet has CRITICAL trust flags');
        }
    }

    // Calculate overall state with Trust Score integration
    const state = calculateOverallStateWithTrustScore(
        creatorVerification,
        counterpartyVerification,
        creatorTrustScore,
        counterpartyTrustScore,
        timeRemaining,
        flags
    );

    const evaluation: TrafficLightEvaluation = {
        state,
        reason: generateReason(state, flags),
        details: {
            creatorStake: creatorVerification,
            counterpartyStake: counterpartyVerification,
            thresholdsMet: creatorVerification.status === 'CONFIRMED' &&
                counterpartyVerification.status === 'CONFIRMED',
            timeRemaining,
            flags,
            trustScores: {
                creator: creatorTrustScore,
                counterparty: counterpartyTrustScore,
            },
        },
        evaluatedAt: Date.now(),
    };

    // Record evaluation
    await recordTrafficLightState(env, challengeId, evaluation);

    return evaluation;
}

/**
 * Get wallet address for a user by user ID.
 */
async function getUserWallet(env: Env, userId: string): Promise<string | null> {
    try {
        const user = await queryOne<{ wallet_address: string }>(
            env.TATTLEHASH_DB,
            'SELECT wallet_address FROM users WHERE id = ?',
            [userId]
        );
        return user?.wallet_address ?? null;
    } catch (error) {
        console.error(`Failed to fetch wallet for user ${userId}:`, error);
        return null;
    }
}

/**
 * Fetch Trust Score for a party and extract key info.
 */
async function fetchPartyTrustScore(
    env: Env,
    wallet: string
): Promise<PartyTrustScore | null> {
    if (!wallet) return null;

    try {
        const score = await getTrustScore(env, wallet, false);
        return {
            wallet,
            score: score.trustScore,
            riskLevel: score.riskLevel,
            hasCriticalFlags: score.flags.some(f => f.severity === 'CRITICAL'),
            confidence: score.confidence,
        };
    } catch (error) {
        console.error(`Trust score fetch failed for ${wallet}:`, error);
        // Return conservative assessment on error
        return {
            wallet,
            score: 50,
            riskLevel: 'MEDIUM',
            hasCriticalFlags: false,
            confidence: 0.1,
        };
    }
}

function evaluateStake(
    stake: Stake | null,
    required: string,
    requiredConfirmations: number
): StakeVerification {
    // No stake required
    if (required === '0') {
        return {
            status: 'NOT_REQUIRED',
            required: '0',
            deposited: '0',
            confirmations: 0,
            requiredConfirmations,
        };
    }

    // No stake provided
    if (!stake) {
        return {
            status: 'PENDING',
            required,
            deposited: '0',
            confirmations: 0,
            requiredConfirmations,
        };
    }

    // Stake exists but not confirmed
    if (stake.status === 'PENDING') {
        return {
            status: 'PENDING',
            required,
            deposited: stake.amount,
            confirmations: 0,
            requiredConfirmations,
        };
    }

    // Stake was slashed or released
    if (stake.status === 'SLASHED' || stake.status === 'RELEASED' || stake.status === 'TRANSFERRED') {
        return {
            status: 'FAILED',
            required,
            deposited: '0',
            confirmations: 0,
            requiredConfirmations,
        };
    }

    // Check amount
    const { valid } = validateStakeAmount(stake.amount, required);
    if (!valid) {
        return {
            status: 'INSUFFICIENT',
            required,
            deposited: stake.amount,
            confirmations: requiredConfirmations, // Assume confirmed if CONFIRMED/HELD
            requiredConfirmations,
        };
    }

    // Stake confirmed and sufficient
    return {
        status: 'CONFIRMED',
        required,
        deposited: stake.amount,
        confirmations: requiredConfirmations,
        requiredConfirmations,
    };
}

/**
 * Calculate overall state WITH Trust Score integration.
 *
 * Rules:
 * - Score 70-100 + verification passed → GREEN
 * - Score 40-69 OR minor issues → YELLOW
 * - Score 0-39 OR verification failed OR critical flags → RED
 */
function calculateOverallStateWithTrustScore(
    creatorVerification: StakeVerification,
    counterpartyVerification: StakeVerification,
    creatorTrustScore: PartyTrustScore | null,
    counterpartyTrustScore: PartyTrustScore | null,
    timeRemaining: number | null,
    flags: string[]
): TrafficLightState {
    // RED conditions - stake failures
    if (creatorVerification.status === 'FAILED' || counterpartyVerification.status === 'FAILED') {
        return 'RED';
    }
    if (creatorVerification.status === 'INSUFFICIENT' || counterpartyVerification.status === 'INSUFFICIENT') {
        return 'RED';
    }
    if (timeRemaining !== null && timeRemaining <= 0) {
        return 'RED';
    }

    // RED conditions - Trust Score critical issues
    if (creatorTrustScore?.riskLevel === 'HIGH' || creatorTrustScore?.hasCriticalFlags) {
        return 'RED';
    }
    if (counterpartyTrustScore?.riskLevel === 'HIGH' || counterpartyTrustScore?.hasCriticalFlags) {
        return 'RED';
    }

    // Check stake verification status
    const creatorStakeOk = creatorVerification.status === 'CONFIRMED' || creatorVerification.status === 'NOT_REQUIRED';
    const counterpartyStakeOk = counterpartyVerification.status === 'CONFIRMED' || counterpartyVerification.status === 'NOT_REQUIRED';

    // Check Trust Score levels
    // If Trust Score is null (couldn't be fetched), don't penalize - treat as OK
    const creatorTrustOk = !creatorTrustScore || creatorTrustScore.riskLevel === 'LOW';
    const counterpartyTrustOk = !counterpartyTrustScore || counterpartyTrustScore.riskLevel === 'LOW';

    // GREEN conditions - everything verified AND both Trust Scores are LOW (or unavailable)
    if (creatorStakeOk && counterpartyStakeOk && creatorTrustOk && counterpartyTrustOk) {
        // Only GREEN if no warnings at all
        const hasWarnings = flags.some(f =>
            f.includes('MEDIUM risk') ||
            f.includes('Less than 1 hour')
        );
        if (!hasWarnings) {
            return 'GREEN';
        }
    }

    // YELLOW - partial verification, MEDIUM risk, or some flags
    return 'YELLOW';
}

/**
 * Legacy function for backwards compatibility.
 * @deprecated Use calculateOverallStateWithTrustScore instead
 */
function calculateOverallState(
    creatorVerification: StakeVerification,
    counterpartyVerification: StakeVerification,
    timeRemaining: number | null,
    flags: string[]
): TrafficLightState {
    // RED conditions
    if (creatorVerification.status === 'FAILED' || counterpartyVerification.status === 'FAILED') {
        return 'RED';
    }
    if (creatorVerification.status === 'INSUFFICIENT' || counterpartyVerification.status === 'INSUFFICIENT') {
        return 'RED';
    }
    if (timeRemaining !== null && timeRemaining <= 0) {
        return 'RED';
    }

    // GREEN conditions - everything verified
    const creatorOk = creatorVerification.status === 'CONFIRMED' || creatorVerification.status === 'NOT_REQUIRED';
    const counterpartyOk = counterpartyVerification.status === 'CONFIRMED' || counterpartyVerification.status === 'NOT_REQUIRED';

    if (creatorOk && counterpartyOk && flags.length === 0) {
        return 'GREEN';
    }

    // YELLOW - partial verification or some flags
    return 'YELLOW';
}

function generateReason(state: TrafficLightState, flags: string[]): string {
    switch (state) {
        case 'GREEN':
            return 'All verifications passed. Safe to proceed.';
        case 'RED':
            return flags.length > 0
                ? `Do not proceed: ${flags[0]}`
                : 'Verification failed. Do not proceed.';
        case 'YELLOW':
            return flags.length > 0
                ? `Proceed with caution: ${flags.join(', ')}`
                : 'Partial verification. Proceed with caution.';
    }
}

function createRedEvaluation(reason: string, flags: string[]): TrafficLightEvaluation {
    const emptyVerification: StakeVerification = {
        status: 'FAILED',
        required: '0',
        deposited: '0',
        confirmations: 0,
        requiredConfirmations: 12,
    };

    return {
        state: 'RED',
        reason,
        details: {
            creatorStake: emptyVerification,
            counterpartyStake: emptyVerification,
            thresholdsMet: false,
            timeRemaining: null,
            flags,
        },
        evaluatedAt: Date.now(),
    };
}

// ============================================================================
// Traffic Light State Recording
// ============================================================================

async function recordTrafficLightState(
    env: Env,
    challengeId: string,
    evaluation: TrafficLightEvaluation
): Promise<void> {
    const id = crypto.randomUUID();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO traffic_light_states (id, challenge_id, state, reason, details, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            id,
            challengeId,
            evaluation.state,
            evaluation.reason,
            JSON.stringify(evaluation.details),
            evaluation.evaluatedAt,
        ]
    );

    // Update the enforced config with current state
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges_enforced_config
         SET traffic_light_state = ?, last_evaluation_at = ?
         WHERE challenge_id = ?`,
        [evaluation.state, evaluation.evaluatedAt, challengeId]
    );

    // Log for observability
    console.log(JSON.stringify({
        t: evaluation.evaluatedAt,
        at: 'traffic_light_evaluated',
        challenge_id: challengeId,
        state: evaluation.state,
        flags_count: evaluation.details.flags.length,
    }));
}

export async function getTrafficLightHistory(
    env: Env,
    challengeId: string
): Promise<TrafficLightRecord[]> {
    return query<TrafficLightRecord>(
        env.TATTLEHASH_DB,
        'SELECT * FROM traffic_light_states WHERE challenge_id = ? ORDER BY evaluated_at DESC',
        [challengeId]
    );
}

export async function getCurrentTrafficLight(
    env: Env,
    challengeId: string
): Promise<TrafficLightRecord | null> {
    return queryOne<TrafficLightRecord>(
        env.TATTLEHASH_DB,
        'SELECT * FROM traffic_light_states WHERE challenge_id = ? ORDER BY evaluated_at DESC LIMIT 1',
        [challengeId]
    );
}

// ============================================================================
// Quick State Checks
// ============================================================================

export async function isGreen(env: Env, challengeId: string): Promise<boolean> {
    const evaluation = await evaluateTrafficLight(env, challengeId);
    return evaluation.state === 'GREEN';
}

export async function isRed(env: Env, challengeId: string): Promise<boolean> {
    const evaluation = await evaluateTrafficLight(env, challengeId);
    return evaluation.state === 'RED';
}

export async function canProceed(env: Env, challengeId: string): Promise<boolean> {
    const evaluation = await evaluateTrafficLight(env, challengeId);
    return evaluation.state !== 'RED';
}
