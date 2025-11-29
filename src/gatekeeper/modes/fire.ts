
import { execute, queryOne, query } from '../../db';
import { createError } from '../../errors';
import { getChallengeById } from '../challenges/create';
import type { Challenge } from '../challenges/types';
import { Env } from '../../types';

/**
 * FIRE Mode - Honesty bonds with dispute resolution
 * 
 * Flow:
 * 1. Both parties deposit honesty bonds
 * 2. Complete transaction off-platform
 * 3. Both attest to completion
 * 4. If dispute: oracle resolves
 * 5. Winner gets both bonds back
 */

export interface FireConfig {
    honesty_bond_amount: string; // In wei
    currency_code: string; // e.g., 'ETH', 'USDC'
    resolution_strategy: 'ORACLE' | 'MAJORITY_VOTE' | 'ADMIN';
    oracle_source?: string;
}

export interface BondDeposit {
    id: string;
    challenge_id: string;
    user_id: string;
    amount: string;
    currency_code: string;
    tx_hash?: string;
    deposited_at: number;
    status: 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'FORFEITED';
}

export async function handleFireMode(
    env: Env,
    challenge: Challenge,
    config: FireConfig
): Promise<Challenge> {
    // Store FIRE config
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges_fire_config (
      challenge_id, honesty_bond_amount, currency_code,
      resolution_strategy, oracle_source
    ) VALUES (?, ?, ?, ?, ?)`,
        [
            challenge.id,
            config.honesty_bond_amount,
            config.currency_code,
            config.resolution_strategy,
            config.oracle_source ?? null,
        ]
    );

    return (await getChallengeById(env, challenge.id))!;
}

export async function depositBond(
    env: Env,
    challengeId: string,
    userId: string,
    txHash?: string
): Promise<BondDeposit> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    const config = await queryOne<FireConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges_fire_config WHERE challenge_id = ?',
        [challengeId]
    );

    if (!config) {
        throw createError('VALIDATION_ERROR', { message: 'Not a FIRE mode challenge' });
    }

    // Create bond deposit record
    const bondId = crypto.randomUUID();
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO bond_deposits (
      id, challenge_id, user_id, amount, currency_code,
      tx_hash, deposited_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            bondId,
            challengeId,
            userId,
            config.honesty_bond_amount,
            config.currency_code,
            txHash ?? null,
            Date.now(),
            txHash ? 'CONFIRMED' : 'PENDING',
        ]
    );

    // Check if both parties deposited
    const deposits = await query(
        env.TATTLEHASH_DB,
        `SELECT * FROM bond_deposits 
     WHERE challenge_id = ? AND status = 'CONFIRMED'`,
        [challengeId]
    );

    if (deposits.length === 2) {
        // Both deposited - transition to INTENT_LOCKED
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE challenges 
       SET status = ?, intent_locked_at = ?, updated_at = ?
       WHERE id = ?`,
            ['INTENT_LOCKED', Date.now(), Date.now(), challengeId]
        );
    }

    return {
        id: bondId,
        challenge_id: challengeId,
        user_id: userId,
        amount: config.honesty_bond_amount,
        currency_code: config.currency_code,
        tx_hash: txHash,
        deposited_at: Date.now(),
        status: txHash ? 'CONFIRMED' : 'PENDING',
    };
}

export async function raiseDispute(
    env: Env,
    challengeId: string,
    userId: string,
    reason: string,
    evidence?: Record<string, unknown>
): Promise<void> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.status !== 'AWAITING_RESOLUTION') {
        throw createError('VALIDATION_ERROR', { message: 'Can only dispute from AWAITING_RESOLUTION' });
    }

    // Create dispute record
    const disputeId = crypto.randomUUID();
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
            Date.now(),
            'PENDING',
        ]
    );

    // Transition challenge to DISPUTED
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET status = ?, updated_at = ? WHERE id = ?`,
        ['DISPUTED', Date.now(), challengeId]
    );
}

export async function resolveDispute(
    env: Env,
    challengeId: string,
    winnerUserId: string,
    resolution: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.status !== 'DISPUTED') {
        throw createError('VALIDATION_ERROR', { message: 'Challenge not in DISPUTED status' });
    }

    // Update dispute record
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenge_disputes 
     SET status = ?, winner_user_id = ?, resolution = ?, resolved_at = ?
     WHERE challenge_id = ? AND status = 'PENDING'`,
        ['RESOLVED', winnerUserId, resolution, Date.now(), challengeId]
    );

    // Release bonds
    const loserUserId = challenge.creator_user_id === winnerUserId
        ? challenge.counterparty_user_id
        : challenge.creator_user_id;

    // Winner gets their bond back
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE bond_deposits 
     SET status = 'RELEASED'
     WHERE challenge_id = ? AND user_id = ?`,
        [challengeId, winnerUserId]
    );

    // Loser forfeits bond
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE bond_deposits 
     SET status = 'FORFEITED'
     WHERE challenge_id = ? AND user_id = ?`,
        [challengeId, loserUserId]
    );

    // Complete challenge
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges 
     SET status = ?, resolved_at = ?, updated_at = ?
     WHERE id = ?`,
        ['COMPLETED', Date.now(), Date.now(), challengeId]
    );

    return (await getChallengeById(env, challengeId))!;
}
