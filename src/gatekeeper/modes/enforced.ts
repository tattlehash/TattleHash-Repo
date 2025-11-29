
import { execute, queryOne } from '../../db';
import { createError } from '../../errors';
import { getChallengeById } from '../challenges/create';
import type { Challenge } from '../challenges/types';
import { Env } from '../../types';

/**
 * ENFORCED Mode - Time-locked escrow with automated enforcement
 * 
 * Flow:
 * 1. Creator creates challenge with timeout configs
 * 2. Counterparty must accept within accept_timeout
 * 3. Both parties must respond within response_timeout
 * 4. Disputes must be resolved within dispute_timeout
 * 5. Automatic transitions on timeout
 */

export interface EnforcedConfig {
    accept_timeout_seconds: number;
    response_timeout_seconds: number;
    dispute_timeout_seconds: number;
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
