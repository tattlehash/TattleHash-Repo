/**
 * Stakes Core Module
 *
 * Handles stake deposits, releases, and slashing for ENFORCED mode.
 * All stake operations are recorded with full audit trail.
 */

import { execute, query, queryOne } from '../../db';
import { createError } from '../../errors';
import { Env } from '../../types';
import type {
    Stake,
    StakeStatus,
    StakeEvent,
    StakeEventType,
    EnforcedThreshold,
    DepositStakeInput,
    ReleaseStakeInput,
} from './types';

// ============================================================================
// Stake CRUD Operations
// ============================================================================

export async function createStake(
    env: Env,
    data: {
        challenge_id: string;
        user_id: string;
        wallet_address: string;
        amount: string;
        currency_code: string;
        chain_id: string;
        token_address?: string;
    }
): Promise<Stake> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO stakes (
            id, challenge_id, user_id, wallet_address, amount,
            currency_code, chain_id, token_address, status,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            data.challenge_id,
            data.user_id,
            data.wallet_address.toLowerCase(),
            data.amount,
            data.currency_code,
            data.chain_id,
            data.token_address?.toLowerCase() ?? null,
            'PENDING',
            now,
            now,
        ]
    );

    await recordStakeEvent(env, id, 'DEPOSIT_INITIATED', null, {
        amount: data.amount,
        currency: data.currency_code,
        chain: data.chain_id,
    });

    return (await getStakeById(env, id))!;
}

export async function getStakeById(env: Env, stakeId: string): Promise<Stake | null> {
    return queryOne<Stake>(
        env.TATTLEHASH_DB,
        'SELECT * FROM stakes WHERE id = ?',
        [stakeId]
    );
}

export async function getStakesByChallenge(env: Env, challengeId: string): Promise<Stake[]> {
    return query<Stake>(
        env.TATTLEHASH_DB,
        'SELECT * FROM stakes WHERE challenge_id = ? ORDER BY created_at',
        [challengeId]
    );
}

export async function getStakeByUserAndChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<Stake | null> {
    return queryOne<Stake>(
        env.TATTLEHASH_DB,
        'SELECT * FROM stakes WHERE challenge_id = ? AND user_id = ?',
        [challengeId, userId]
    );
}

// ============================================================================
// Stake Status Transitions
// ============================================================================

export async function confirmStakeDeposit(
    env: Env,
    stakeId: string,
    txHash: string,
    confirmations: number
): Promise<Stake> {
    const stake = await getStakeById(env, stakeId);
    if (!stake) {
        throw createError('NOT_FOUND', { resource: 'stake', id: stakeId });
    }

    if (stake.status !== 'PENDING') {
        throw createError('VALIDATION_ERROR', {
            message: `Cannot confirm stake in status ${stake.status}`,
        });
    }

    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE stakes
         SET status = ?, deposit_tx_hash = ?, deposited_at = ?, confirmed_at = ?, updated_at = ?
         WHERE id = ?`,
        ['CONFIRMED', txHash, now, now, now, stakeId]
    );

    await recordStakeEvent(env, stakeId, 'DEPOSIT_CONFIRMED', txHash, {
        confirmations,
    });

    return (await getStakeById(env, stakeId))!;
}

export async function lockStake(env: Env, stakeId: string): Promise<Stake> {
    const stake = await getStakeById(env, stakeId);
    if (!stake) {
        throw createError('NOT_FOUND', { resource: 'stake', id: stakeId });
    }

    if (stake.status !== 'CONFIRMED') {
        throw createError('VALIDATION_ERROR', {
            message: `Cannot lock stake in status ${stake.status}`,
        });
    }

    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE stakes SET status = ?, updated_at = ? WHERE id = ?`,
        ['HELD', now, stakeId]
    );

    await recordStakeEvent(env, stakeId, 'LOCKED', null, {
        locked_at: now,
    });

    return (await getStakeById(env, stakeId))!;
}

export async function releaseStake(
    env: Env,
    stakeId: string,
    releaseType: 'RELEASED' | 'TRANSFERRED',
    txHash?: string,
    reason?: string
): Promise<Stake> {
    const stake = await getStakeById(env, stakeId);
    if (!stake) {
        throw createError('NOT_FOUND', { resource: 'stake', id: stakeId });
    }

    if (stake.status !== 'HELD' && stake.status !== 'CONFIRMED') {
        throw createError('VALIDATION_ERROR', {
            message: `Cannot release stake in status ${stake.status}`,
        });
    }

    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE stakes
         SET status = ?, release_tx_hash = ?, released_at = ?, updated_at = ?
         WHERE id = ?`,
        [releaseType, txHash ?? null, now, now, stakeId]
    );

    const eventType: StakeEventType = releaseType === 'RELEASED' ? 'RELEASED' : 'TRANSFERRED';
    await recordStakeEvent(env, stakeId, eventType, txHash ?? null, {
        reason,
        released_at: now,
    });

    return (await getStakeById(env, stakeId))!;
}

export async function slashStake(
    env: Env,
    stakeId: string,
    reason: string,
    details?: Record<string, unknown>
): Promise<Stake> {
    const stake = await getStakeById(env, stakeId);
    if (!stake) {
        throw createError('NOT_FOUND', { resource: 'stake', id: stakeId });
    }

    if (stake.status !== 'HELD' && stake.status !== 'CONFIRMED') {
        throw createError('VALIDATION_ERROR', {
            message: `Cannot slash stake in status ${stake.status}`,
        });
    }

    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE stakes SET status = ?, released_at = ?, updated_at = ? WHERE id = ?`,
        ['SLASHED', now, now, stakeId]
    );

    await recordStakeEvent(env, stakeId, 'SLASHED', null, {
        reason,
        ...details,
        slashed_at: now,
    });

    return (await getStakeById(env, stakeId))!;
}

// ============================================================================
// Threshold Operations
// ============================================================================

export async function createThreshold(
    env: Env,
    challengeId: string,
    data: {
        min_usd_value: string;
        max_usd_value?: string;
        required_confirmations?: number;
        allowed_chains: string[];
        allowed_assets: string[];
        deal_expiry_at?: string;
        creator_stake_required: string;
        counterparty_stake_required: string;
        stake_currency: string;
    }
): Promise<EnforcedThreshold> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_thresholds (
            id, challenge_id, min_usd_value, max_usd_value,
            required_confirmations, allowed_chains, allowed_assets,
            deal_expiry_at, creator_stake_required, counterparty_stake_required,
            stake_currency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            challengeId,
            data.min_usd_value,
            data.max_usd_value ?? null,
            data.required_confirmations ?? 12,
            JSON.stringify(data.allowed_chains),
            JSON.stringify(data.allowed_assets),
            data.deal_expiry_at ?? null,
            data.creator_stake_required,
            data.counterparty_stake_required,
            data.stake_currency,
            now,
        ]
    );

    return (await getThresholdByChallenge(env, challengeId))!;
}

export async function getThresholdByChallenge(
    env: Env,
    challengeId: string
): Promise<EnforcedThreshold | null> {
    return queryOne<EnforcedThreshold>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_thresholds WHERE challenge_id = ?',
        [challengeId]
    );
}

// ============================================================================
// Stake Event Recording
// ============================================================================

export async function recordStakeEvent(
    env: Env,
    stakeId: string,
    eventType: StakeEventType,
    txHash: string | null,
    details?: Record<string, unknown>
): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO stake_events (id, stake_id, event_type, tx_hash, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            id,
            stakeId,
            eventType,
            txHash,
            details ? JSON.stringify(details) : null,
            now,
        ]
    );

    // Log for observability
    console.log(JSON.stringify({
        t: now,
        at: 'stake_event',
        stake_id: stakeId,
        event_type: eventType,
        tx_hash: txHash,
    }));
}

export async function getStakeEvents(env: Env, stakeId: string): Promise<StakeEvent[]> {
    return query<StakeEvent>(
        env.TATTLEHASH_DB,
        'SELECT * FROM stake_events WHERE stake_id = ? ORDER BY created_at',
        [stakeId]
    );
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function isChainAllowed(chain: string, allowedChains: string[]): boolean {
    return allowedChains.includes(chain);
}

export function isAssetAllowed(asset: string, allowedAssets: string[]): boolean {
    return allowedAssets.includes(asset.toUpperCase());
}

export function validateStakeAmount(
    amount: string,
    required: string
): { valid: boolean; deficit: string } {
    const amountBigInt = BigInt(amount);
    const requiredBigInt = BigInt(required);

    if (amountBigInt >= requiredBigInt) {
        return { valid: true, deficit: '0' };
    }

    return {
        valid: false,
        deficit: (requiredBigInt - amountBigInt).toString(),
    };
}
