
import { execute } from '../../db';
import { createError } from '../../errors';
import { getChallengeById } from '../challenges/create';
import type { Challenge } from '../challenges/types';
import { Env } from '../../types';

/**
 * SOLO Mode - Self-attestation without counterparty
 * 
 * Flow:
 * 1. Creator creates challenge (no counterparty)
 * 2. Creator completes immediately → COMPLETED
 * 
 * No verification required - just a self-declaration.
 */

export async function handleSoloMode(
    env: Env,
    challenge: Challenge
): Promise<Challenge> {
    // SOLO mode has no counterparty
    if (challenge.counterparty_user_id) {
        throw createError('CHALLENGE_SOLO_NO_COUNTERPARTY');
    }

    // Immediately transition to INTENT_LOCKED
    // No verification needed for self-attestation
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges 
     SET status = ?, intent_locked_at = ?, updated_at = ?
     WHERE id = ?`,
        ['INTENT_LOCKED', Date.now(), Date.now(), challenge.id]
    );

    return (await getChallengeById(env, challenge.id))!;
}

export async function completeSoloChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.creator_user_id !== userId) {
        throw createError('FORBIDDEN');
    }

    if (challenge.status !== 'INTENT_LOCKED') {
        throw createError('VALIDATION_ERROR', { message: 'Challenge not in INTENT_LOCKED status' });
    }

    // Mark as completed
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges 
     SET status = ?, resolved_at = ?, updated_at = ?
     WHERE id = ?`,
        ['COMPLETED', Date.now(), Date.now(), challengeId]
    );

    return (await getChallengeById(env, challengeId))!;
}
