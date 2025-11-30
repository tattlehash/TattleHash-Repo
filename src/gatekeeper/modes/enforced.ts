
import { execute, queryOne } from '../../db';
import { createError } from '../../errors';
import { getChallengeById } from '../challenges/create';
import type { Challenge } from '../challenges/types';
import { Env } from '../../types';
import {
    createStake,
    createThreshold,
    getStakesByChallenge,
    getStakeByUserAndChallenge,
    getThresholdByChallenge,
    confirmStakeDeposit,
    lockStake,
    releaseStake,
    slashStake,
    isChainAllowed,
    isAssetAllowed,
    validateStakeAmount,
    evaluateTrafficLight,
    isGreen,
    canProceed,
    ENFORCED_DEFAULTS,
} from '../stakes';
import type {
    CreateEnforcedChallengeInput,
    EnforcedChallengeStatus,
    TrafficLightEvaluation,
    Stake,
    EnforcedThreshold,
} from '../stakes/types';

/**
 * ENFORCED Mode - Full escrow with threshold logic
 *
 * Key Features:
 * - Stakes: Both parties deposit funds as collateral
 * - Thresholds: Min/max USD, required confirmations, allowed chains
 * - Traffic Light: GREEN/YELLOW/RED status for transaction safety
 * - Automatic enforcement on timeouts
 *
 * Flow:
 * 1. Creator creates challenge with thresholds and stake requirements
 * 2. Both parties deposit stakes (must meet requirements)
 * 3. Traffic light turns GREEN when all verifications pass
 * 4. Both parties confirm completion
 * 5. Stakes released to depositors
 * 6. On dispute: winner gets their stake back, loser forfeits
 * 7. On timeout: stakes may be slashed depending on phase
 */

export interface EnforcedConfig {
    accept_timeout_seconds: number;
    response_timeout_seconds: number;
    dispute_timeout_seconds: number;
    threshold_id?: string;
    traffic_light_state?: 'GREEN' | 'YELLOW' | 'RED';
    last_evaluation_at?: number;
}

export async function handleEnforcedMode(
    env: Env,
    challenge: Challenge,
    config: EnforcedConfig
): Promise<Challenge> {
    // Store enforced config
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges_enforced_config (
      challenge_id, accept_timeout_seconds, 
      response_timeout_seconds, dispute_timeout_seconds
    ) VALUES (?, ?, ?, ?)`,
        [
            challenge.id,
            config.accept_timeout_seconds,
            config.response_timeout_seconds,
            config.dispute_timeout_seconds,
        ]
    );

    // Set accept deadline
    const acceptDeadline = Date.now() + (config.accept_timeout_seconds * 1000);
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges 
     SET expires_at = ?, updated_at = ?
     WHERE id = ?`,
        [new Date(acceptDeadline).toISOString(), Date.now(), challenge.id]
    );

    return (await getChallengeById(env, challenge.id))!;
}

export async function checkEnforcedTimeouts(
    env: Env,
    challengeId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    const config = await queryOne<EnforcedConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges_enforced_config WHERE challenge_id = ?',
        [challengeId]
    );

    if (!config) {
        return challenge;
    }

    const now = Date.now();

    // Check accept timeout
    if (challenge.status === 'AWAITING_COUNTERPARTY' && challenge.expires_at) {
        const deadline = new Date(challenge.expires_at).getTime();
        if (now > deadline) {
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?`,
                ['EXPIRED', now, challengeId]
            );
            return (await getChallengeById(env, challengeId))!;
        }
    }

    // Check response timeout
    if (challenge.status === 'INTENT_LOCKED' && challenge.intent_locked_at) {
        const responseDeadline = challenge.intent_locked_at + (config.response_timeout_seconds * 1000);
        if (now > responseDeadline) {
            // Auto-cancel if no response
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?`,
                ['CANCELLED', now, challengeId]
            );
            return (await getChallengeById(env, challengeId))!;
        }
    }

    // Check dispute timeout
    if (challenge.status === 'DISPUTED') {
        const disputeStarted = await queryOne<{ created_at: number }>(
            env.TATTLEHASH_DB,
            `SELECT created_at FROM challenge_disputes 
       WHERE challenge_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
            [challengeId]
        );

        if (disputeStarted) {
            const disputeDeadline = disputeStarted.created_at + (config.dispute_timeout_seconds * 1000);
            if (now > disputeDeadline) {
                // Auto-resolve dispute (default to cancellation)
                await execute(
                    env.TATTLEHASH_DB,
                    `UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?`,
                    ['CANCELLED', now, challengeId]
                );
                return (await getChallengeById(env, challengeId))!;
            }
        }
    }

    return challenge;
}

export async function enforceCompletion(
    env: Env,
    challengeId: string,
    userId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    // Check timeouts first
    const updated = await checkEnforcedTimeouts(env, challengeId);

    if (updated.status !== 'INTENT_LOCKED') {
        throw createError('VALIDATION_ERROR', { message: 'Challenge not in INTENT_LOCKED status' });
    }

    // Record completion
    await env.GATE_KV.put(
        `enforced_completion:${challengeId}:${userId}`,
        JSON.stringify({ completed_at: Date.now() }),
        { expirationTtl: 86400 * 30 }
    );

    // Check if both completed
    const creatorCompleted = await env.GATE_KV.get(`enforced_completion:${challengeId}:${challenge.creator_user_id}`);
    const counterpartyCompleted = await env.GATE_KV.get(`enforced_completion:${challengeId}:${challenge.counterparty_user_id}`);

    if (creatorCompleted && counterpartyCompleted) {
        // Both completed - finalize
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE challenges 
       SET status = ?, resolved_at = ?, updated_at = ?
       WHERE id = ?`,
            ['COMPLETED', Date.now(), Date.now(), challengeId]
        );
    }

    return (await getChallengeById(env, challengeId))!;
}

// ============================================================================
// Full Enforced Mode Challenge Creation
// ============================================================================

export async function createEnforcedChallenge(
    env: Env,
    input: CreateEnforcedChallengeInput,
    creatorUserId: string
): Promise<{ challenge: Challenge; thresholds: EnforcedThreshold; trafficLight: TrafficLightEvaluation }> {
    const challengeId = crypto.randomUUID();
    const now = Date.now();

    // Create base challenge
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges (
            id, mode, creator_user_id, counterparty_user_id,
            title, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            challengeId,
            'ENFORCED',
            creatorUserId,
            input.counterparty_user_id,
            input.title,
            input.description ?? null,
            'DRAFT',
            now,
            now,
        ]
    );

    // Create threshold configuration
    const thresholds = await createThreshold(env, challengeId, {
        min_usd_value: input.thresholds.min_usd_value,
        max_usd_value: input.thresholds.max_usd_value,
        required_confirmations: input.thresholds.required_confirmations,
        allowed_chains: input.thresholds.allowed_chains,
        allowed_assets: input.thresholds.allowed_assets,
        deal_expiry_at: input.thresholds.deal_expiry_at,
        creator_stake_required: input.stakes.creator_stake,
        counterparty_stake_required: input.stakes.counterparty_stake,
        stake_currency: input.stakes.stake_currency,
    });

    // Create enforced config with timeouts
    const config: EnforcedConfig = {
        accept_timeout_seconds: input.accept_timeout_seconds ?? ENFORCED_DEFAULTS.ACCEPT_TIMEOUT_SECONDS,
        response_timeout_seconds: input.response_timeout_seconds ?? ENFORCED_DEFAULTS.RESPONSE_TIMEOUT_SECONDS,
        dispute_timeout_seconds: input.dispute_timeout_seconds ?? ENFORCED_DEFAULTS.DISPUTE_TIMEOUT_SECONDS,
        threshold_id: thresholds.id,
        traffic_light_state: 'YELLOW',
    };

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges_enforced_config (
            challenge_id, accept_timeout_seconds, response_timeout_seconds,
            dispute_timeout_seconds, threshold_id, traffic_light_state
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            challengeId,
            config.accept_timeout_seconds,
            config.response_timeout_seconds,
            config.dispute_timeout_seconds,
            config.threshold_id,
            config.traffic_light_state,
        ]
    );

    const challenge = (await getChallengeById(env, challengeId))!;
    const trafficLight = await evaluateTrafficLight(env, challengeId);

    // Log creation
    console.log(JSON.stringify({
        t: now,
        at: 'enforced_challenge_created',
        challenge_id: challengeId,
        creator: creatorUserId,
        counterparty: input.counterparty_user_id,
        thresholds: {
            min_usd: input.thresholds.min_usd_value,
            max_usd: input.thresholds.max_usd_value,
            confirmations: input.thresholds.required_confirmations,
        },
    }));

    return { challenge, thresholds, trafficLight };
}

// ============================================================================
// Stake Deposit Flow
// ============================================================================

export async function depositEnforcedStake(
    env: Env,
    challengeId: string,
    userId: string,
    data: {
        wallet_address: string;
        chain_id: string;
        token_address?: string;
        tx_hash: string;
        amount: string;
        currency_code: string;
    }
): Promise<{ stake: Stake; trafficLight: TrafficLightEvaluation }> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.mode !== 'ENFORCED') {
        throw createError('VALIDATION_ERROR', { message: 'Not an ENFORCED mode challenge' });
    }

    // Verify user is a participant
    if (userId !== challenge.creator_user_id && userId !== challenge.counterparty_user_id) {
        throw createError('FORBIDDEN', { message: 'User is not a participant in this challenge' });
    }

    // Get threshold config
    const threshold = await getThresholdByChallenge(env, challengeId);
    if (!threshold) {
        throw createError('VALIDATION_ERROR', { message: 'No threshold configuration found' });
    }

    // Validate chain and asset
    const allowedChains = JSON.parse(threshold.allowed_chains) as string[];
    const allowedAssets = JSON.parse(threshold.allowed_assets) as string[];

    if (!isChainAllowed(data.chain_id, allowedChains)) {
        throw createError('VALIDATION_ERROR', {
            message: `Chain ${data.chain_id} not allowed`,
            allowed: allowedChains,
        });
    }

    if (!isAssetAllowed(data.currency_code, allowedAssets)) {
        throw createError('VALIDATION_ERROR', {
            message: `Asset ${data.currency_code} not allowed`,
            allowed: allowedAssets,
        });
    }

    // Check if user already has a stake
    const existingStake = await getStakeByUserAndChallenge(env, challengeId, userId);
    if (existingStake) {
        throw createError('VALIDATION_ERROR', { message: 'Stake already deposited' });
    }

    // Validate stake amount
    const requiredAmount = userId === challenge.creator_user_id
        ? threshold.creator_stake_required
        : threshold.counterparty_stake_required;

    const { valid, deficit } = validateStakeAmount(data.amount, requiredAmount);
    if (!valid) {
        throw createError('FUNDS_INSUFFICIENT', {
            required: requiredAmount,
            deposited: data.amount,
            deficit,
        });
    }

    // Create stake
    const stake = await createStake(env, {
        challenge_id: challengeId,
        user_id: userId,
        wallet_address: data.wallet_address,
        amount: data.amount,
        currency_code: data.currency_code,
        chain_id: data.chain_id,
        token_address: data.token_address,
    });

    // Confirm stake (in real implementation, verify tx_hash on-chain)
    const confirmedStake = await confirmStakeDeposit(env, stake.id, data.tx_hash, threshold.required_confirmations);

    // Re-evaluate traffic light
    const trafficLight = await evaluateTrafficLight(env, challengeId);

    // Check if both stakes are now confirmed
    await checkAndTransitionToReady(env, challengeId);

    return { stake: confirmedStake, trafficLight };
}

// ============================================================================
// Challenge State Transitions
// ============================================================================

async function checkAndTransitionToReady(env: Env, challengeId: string): Promise<void> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge || challenge.status !== 'DRAFT') {
        return;
    }

    // Check if traffic light is GREEN
    const isReady = await isGreen(env, challengeId);
    if (isReady) {
        const now = Date.now();

        // Get config for accept deadline
        const config = await queryOne<EnforcedConfig>(
            env.TATTLEHASH_DB,
            'SELECT * FROM challenges_enforced_config WHERE challenge_id = ?',
            [challengeId]
        );

        if (config) {
            const acceptDeadline = now + (config.accept_timeout_seconds * 1000);
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenges
                 SET status = ?, expires_at = ?, updated_at = ?
                 WHERE id = ?`,
                ['AWAITING_COUNTERPARTY', new Date(acceptDeadline).toISOString(), now, challengeId]
            );

            console.log(JSON.stringify({
                t: now,
                at: 'enforced_ready_for_counterparty',
                challenge_id: challengeId,
                accept_deadline: acceptDeadline,
            }));
        }
    }
}

export async function acceptEnforcedChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<{ challenge: Challenge; trafficLight: TrafficLightEvaluation }> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.mode !== 'ENFORCED') {
        throw createError('VALIDATION_ERROR', { message: 'Not an ENFORCED mode challenge' });
    }

    if (userId !== challenge.counterparty_user_id) {
        throw createError('CHALLENGE_NOT_COUNTERPARTY');
    }

    // Check timeouts first
    await checkEnforcedTimeouts(env, challengeId);
    const updatedChallenge = await getChallengeById(env, challengeId);

    if (updatedChallenge!.status !== 'AWAITING_COUNTERPARTY') {
        throw createError('CHALLENGE_INVALID_STATUS_FOR_ACCEPT', {
            current: updatedChallenge!.status,
        });
    }

    // Verify traffic light allows proceeding
    if (!await canProceed(env, challengeId)) {
        throw createError('VALIDATION_ERROR', {
            message: 'Cannot accept - traffic light is RED',
        });
    }

    // Lock both stakes
    const stakes = await getStakesByChallenge(env, challengeId);
    for (const stake of stakes) {
        if (stake.status === 'CONFIRMED') {
            await lockStake(env, stake.id);
        }
    }

    // Transition to INTENT_LOCKED
    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges
         SET status = ?, intent_locked_at = ?, updated_at = ?
         WHERE id = ?`,
        ['INTENT_LOCKED', now, now, challengeId]
    );

    const finalChallenge = (await getChallengeById(env, challengeId))!;
    const trafficLight = await evaluateTrafficLight(env, challengeId);

    console.log(JSON.stringify({
        t: now,
        at: 'enforced_intent_locked',
        challenge_id: challengeId,
        stakes_locked: stakes.length,
    }));

    return { challenge: finalChallenge, trafficLight };
}

// ============================================================================
// Completion and Stake Release
// ============================================================================

export async function completeEnforcedChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<{ challenge: Challenge; trafficLight: TrafficLightEvaluation }> {
    // Use existing completion logic
    const challenge = await enforceCompletion(env, challengeId, userId);

    // If completed, release all stakes
    if (challenge.status === 'COMPLETED') {
        await releaseAllStakes(env, challengeId, 'Transaction completed successfully');
    }

    const trafficLight = await evaluateTrafficLight(env, challengeId);
    return { challenge, trafficLight };
}

async function releaseAllStakes(env: Env, challengeId: string, reason: string): Promise<void> {
    const stakes = await getStakesByChallenge(env, challengeId);

    for (const stake of stakes) {
        if (stake.status === 'HELD' || stake.status === 'CONFIRMED') {
            await releaseStake(env, stake.id, 'RELEASED', undefined, reason);
        }
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enforced_stakes_released',
        challenge_id: challengeId,
        stakes_released: stakes.length,
        reason,
    }));
}

// ============================================================================
// Dispute Handling with Stake Resolution
// ============================================================================

export async function raiseEnforcedDispute(
    env: Env,
    challengeId: string,
    userId: string,
    reason: string,
    evidence?: Record<string, unknown>
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.mode !== 'ENFORCED') {
        throw createError('VALIDATION_ERROR', { message: 'Not an ENFORCED mode challenge' });
    }

    // Can only dispute from INTENT_LOCKED or AWAITING_RESOLUTION
    if (challenge.status !== 'INTENT_LOCKED' && challenge.status !== 'AWAITING_RESOLUTION') {
        throw createError('VALIDATION_ERROR', {
            message: 'Can only raise dispute from INTENT_LOCKED or AWAITING_RESOLUTION',
        });
    }

    // Create dispute record
    const disputeId = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenge_disputes (
            id, challenge_id, raised_by_user_id, reason, evidence, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            disputeId,
            challengeId,
            userId,
            reason,
            JSON.stringify(evidence ?? {}),
            now,
            'PENDING',
        ]
    );

    // Transition to DISPUTED
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?`,
        ['DISPUTED', now, challengeId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'enforced_dispute_raised',
        challenge_id: challengeId,
        dispute_id: disputeId,
        raised_by: userId,
    }));

    return (await getChallengeById(env, challengeId))!;
}

export async function resolveEnforcedDispute(
    env: Env,
    challengeId: string,
    winnerUserId: string,
    resolution: string
): Promise<{ challenge: Challenge; trafficLight: TrafficLightEvaluation }> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.status !== 'DISPUTED') {
        throw createError('VALIDATION_ERROR', { message: 'Challenge not in DISPUTED status' });
    }

    const now = Date.now();

    // Update dispute record
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenge_disputes
         SET status = ?, winner_user_id = ?, resolution = ?, resolved_at = ?
         WHERE challenge_id = ? AND status = 'PENDING'`,
        ['RESOLVED', winnerUserId, resolution, now, challengeId]
    );

    // Release winner's stake, slash loser's stake
    const stakes = await getStakesByChallenge(env, challengeId);
    const loserUserId = challenge.creator_user_id === winnerUserId
        ? challenge.counterparty_user_id
        : challenge.creator_user_id;

    for (const stake of stakes) {
        if (stake.status === 'HELD' || stake.status === 'CONFIRMED') {
            if (stake.user_id === winnerUserId) {
                await releaseStake(env, stake.id, 'RELEASED', undefined, `Dispute resolved in favor of user`);
            } else {
                await slashStake(env, stake.id, `Dispute resolved against user: ${resolution}`);
            }
        }
    }

    // Complete challenge
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges
         SET status = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`,
        ['COMPLETED', now, now, challengeId]
    );

    const finalChallenge = (await getChallengeById(env, challengeId))!;
    const trafficLight = await evaluateTrafficLight(env, challengeId);

    console.log(JSON.stringify({
        t: now,
        at: 'enforced_dispute_resolved',
        challenge_id: challengeId,
        winner: winnerUserId,
        loser: loserUserId,
    }));

    return { challenge: finalChallenge, trafficLight };
}

// ============================================================================
// Timeout Handling with Stake Slashing
// ============================================================================

export async function handleEnforcedTimeout(
    env: Env,
    challengeId: string
): Promise<{ challenge: Challenge; stakesSlashed: number }> {
    const challenge = await checkEnforcedTimeouts(env, challengeId);
    let stakesSlashed = 0;

    // If challenge expired or cancelled due to timeout, handle stakes
    if (challenge.status === 'EXPIRED' || challenge.status === 'CANCELLED') {
        const stakes = await getStakesByChallenge(env, challengeId);

        for (const stake of stakes) {
            if (stake.status === 'HELD' || stake.status === 'CONFIRMED') {
                // In timeout scenarios, typically both stakes are returned
                // unless one party is clearly at fault
                await releaseStake(env, stake.id, 'RELEASED', undefined, 'Challenge expired/cancelled - stake returned');
                stakesSlashed++;
            }
        }

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'enforced_timeout_handled',
            challenge_id: challengeId,
            final_status: challenge.status,
            stakes_released: stakesSlashed,
        }));
    }

    return { challenge, stakesSlashed };
}

// ============================================================================
// Status Retrieval
// ============================================================================

export async function getEnforcedChallengeStatus(
    env: Env,
    challengeId: string
): Promise<EnforcedChallengeStatus> {
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.mode !== 'ENFORCED') {
        throw createError('VALIDATION_ERROR', { message: 'Not an ENFORCED mode challenge' });
    }

    const config = await queryOne<EnforcedConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges_enforced_config WHERE challenge_id = ?',
        [challengeId]
    );

    const threshold = await getThresholdByChallenge(env, challengeId);
    const stakes = await getStakesByChallenge(env, challengeId);
    const trafficLight = await evaluateTrafficLight(env, challengeId);

    const creatorStake = stakes.find(s => s.user_id === challenge.creator_user_id) ?? null;
    const counterpartyStake = stakes.find(s => s.user_id === challenge.counterparty_user_id) ?? null;

    // Calculate deadlines
    let acceptDeadline: string | null = null;
    let responseDeadline: string | null = null;
    let disputeDeadline: string | null = null;

    if (challenge.expires_at) {
        acceptDeadline = challenge.expires_at;
    }

    if (challenge.intent_locked_at && config) {
        const responseMs = challenge.intent_locked_at + (config.response_timeout_seconds * 1000);
        responseDeadline = new Date(responseMs).toISOString();
    }

    return {
        challenge_id: challengeId,
        status: challenge.status,
        trafficLight,
        stakes: {
            creator: creatorStake,
            counterparty: counterpartyStake,
        },
        thresholds: threshold ? {
            min_usd_value: threshold.min_usd_value,
            max_usd_value: threshold.max_usd_value,
            required_confirmations: threshold.required_confirmations,
            allowed_chains: JSON.parse(threshold.allowed_chains),
            allowed_assets: JSON.parse(threshold.allowed_assets),
            deal_expiry_at: threshold.deal_expiry_at,
        } : {
            min_usd_value: '0',
            max_usd_value: null,
            required_confirmations: 12,
            allowed_chains: [],
            allowed_assets: [],
            deal_expiry_at: null,
        },
        timeouts: {
            accept_deadline: acceptDeadline,
            response_deadline: responseDeadline,
            dispute_deadline: disputeDeadline,
        },
    };
}
