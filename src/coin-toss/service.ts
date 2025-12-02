/**
 * Coin Toss Service
 *
 * Core logic for provably fair coin toss using blockchain anchor block hash.
 *
 * Randomness: result = blockHash[0] % 2
 *   - 0 = heads
 *   - 1 = tails
 */

import type { Env } from '../types';
import type {
    CoinTossData,
    CoinTossVerification,
    CoinSide,
    CoinTossParty,
    CoinTossStatus,
    FeeArrangement,
} from './types';
import {
    COIN_TOSS_KV_PREFIX,
    COIN_TOSS_TTL_SECONDS,
    GATEKEEPER_FEE_CENTS,
} from './types';

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute coin toss result from block hash.
 *
 * Uses first byte of block hash modulo 2:
 * - 0 = heads
 * - 1 = tails
 *
 * @param blockHash - The block hash from anchor transaction (0x prefixed)
 * @returns The computed coin side
 */
export function computeResult(blockHash: string): CoinSide {
    // Remove 0x prefix if present
    const hash = blockHash.startsWith('0x') ? blockHash.slice(2) : blockHash;

    // Get first byte (2 hex characters)
    const firstByte = parseInt(hash.slice(0, 2), 16);

    // Modulo 2: 0 = heads, 1 = tails
    return firstByte % 2 === 0 ? 'heads' : 'tails';
}

/**
 * Determine sponsor and sponsored party based on result.
 *
 * The party whose call does NOT match the result is the sponsor (pays).
 * The party whose call matches the result is sponsored (fee waived).
 */
export function determineSponsor(
    result: CoinSide,
    creatorCall: CoinSide
): { sponsor: CoinTossParty; sponsoredParty: CoinTossParty } {
    // Creator wins if their call matches the result
    const creatorWins = result === creatorCall;

    // The "loser" sponsors (pays the fee)
    return {
        sponsor: creatorWins ? 'counterparty' : 'creator',
        sponsoredParty: creatorWins ? 'creator' : 'counterparty',
    };
}

/**
 * Get the opposite side of a coin call.
 */
export function getOppositeSide(side: CoinSide): CoinSide {
    return side === 'heads' ? 'tails' : 'heads';
}

/**
 * Verify a coin toss result is correct given the block hash.
 */
export function verifyCoinToss(data: CoinTossData): CoinTossVerification {
    if (!data.block_hash || !data.block_number || !data.result) {
        return {
            valid: false,
            inputs: {
                block_hash: data.block_hash || '',
                block_number: data.block_number || 0,
            },
            computation: {
                first_byte_hex: '',
                first_byte_int: 0,
                modulo_2: 0,
                computed_result: 'heads',
            },
            recorded_result: data.result || 'heads',
            match: false,
        };
    }

    const hash = data.block_hash.startsWith('0x')
        ? data.block_hash.slice(2)
        : data.block_hash;
    const firstByteHex = hash.slice(0, 2);
    const firstByteInt = parseInt(firstByteHex, 16);
    const modulo2 = firstByteInt % 2;
    const computedResult: CoinSide = modulo2 === 0 ? 'heads' : 'tails';

    const match = computedResult === data.result;

    return {
        valid: match,
        inputs: {
            block_hash: data.block_hash,
            block_number: data.block_number,
        },
        computation: {
            first_byte_hex: `0x${firstByteHex}`,
            first_byte_int: firstByteInt,
            modulo_2: modulo2,
            computed_result: computedResult,
        },
        recorded_result: data.result,
        match,
    };
}

// ============================================================================
// KV Storage Functions
// ============================================================================

/**
 * Get the KV key for a coin toss.
 */
function getCoinTossKey(challengeId: string): string {
    return `${COIN_TOSS_KV_PREFIX}${challengeId}`;
}

/**
 * Initialize a coin toss for a challenge.
 */
export async function initializeCoinToss(
    env: Env,
    challengeId: string,
    creatorCall: CoinSide,
    feeAmountCents: number = GATEKEEPER_FEE_CENTS
): Promise<CoinTossData> {
    const data: CoinTossData = {
        challenge_id: challengeId,
        status: 'pending',
        creator_call: creatorCall,
        counterparty_call: getOppositeSide(creatorCall),
        fee_amount_cents: feeAmountCents,
        created_at: Date.now(),
    };

    await env.GATE_KV.put(
        getCoinTossKey(challengeId),
        JSON.stringify(data),
        { expirationTtl: COIN_TOSS_TTL_SECONDS }
    );

    return data;
}

/**
 * Get coin toss data for a challenge.
 */
export async function getCoinToss(
    env: Env,
    challengeId: string
): Promise<CoinTossData | null> {
    const raw = await env.GATE_KV.get(getCoinTossKey(challengeId));
    if (!raw) return null;

    return JSON.parse(raw) as CoinTossData;
}

/**
 * Update coin toss status when counterparty accepts.
 */
export async function markCounterpartyAccepted(
    env: Env,
    challengeId: string
): Promise<CoinTossData | null> {
    const data = await getCoinToss(env, challengeId);
    if (!data) return null;

    data.status = 'ready';
    data.accepted_at = Date.now();

    await env.GATE_KV.put(
        getCoinTossKey(challengeId),
        JSON.stringify(data),
        { expirationTtl: COIN_TOSS_TTL_SECONDS }
    );

    return data;
}

/**
 * Record the coin toss result after anchoring.
 *
 * @param env - Environment bindings
 * @param challengeId - Challenge ID
 * @param blockHash - Block hash from anchor transaction
 * @param blockNumber - Block number from anchor transaction
 * @returns Updated coin toss data with result
 */
export async function recordCoinTossResult(
    env: Env,
    challengeId: string,
    blockHash: string,
    blockNumber: number
): Promise<CoinTossData | null> {
    const data = await getCoinToss(env, challengeId);
    if (!data) return null;

    // Compute result from block hash
    const result = computeResult(blockHash);
    const { sponsor, sponsoredParty } = determineSponsor(result, data.creator_call);

    // Update data
    data.status = 'flipped';
    data.block_hash = blockHash;
    data.block_number = blockNumber;
    data.result = result;
    data.sponsor = sponsor;
    data.sponsored_party = sponsoredParty;
    data.flipped_at = Date.now();

    await env.GATE_KV.put(
        getCoinTossKey(challengeId),
        JSON.stringify(data),
        { expirationTtl: COIN_TOSS_TTL_SECONDS }
    );

    return data;
}

/**
 * Cancel a coin toss.
 */
export async function cancelCoinToss(
    env: Env,
    challengeId: string
): Promise<void> {
    const data = await getCoinToss(env, challengeId);
    if (!data) return;

    data.status = 'cancelled';

    await env.GATE_KV.put(
        getCoinTossKey(challengeId),
        JSON.stringify(data),
        { expirationTtl: COIN_TOSS_TTL_SECONDS }
    );
}

// ============================================================================
// Anchor Integration
// ============================================================================

/**
 * Check if a coin toss is ready to be resolved and resolve it if blockchain data is available.
 *
 * This is called when querying coin toss status. If the challenge has been anchored
 * and we have blockchain data, we compute and store the result.
 *
 * @param env - Environment bindings
 * @param challengeId - Challenge ID
 * @param blockHash - Block hash from confirmed anchor transaction
 * @param blockNumber - Block number from confirmed anchor transaction
 * @returns Updated coin toss data, or null if not found/not ready
 */
export async function resolveIfReady(
    env: Env,
    challengeId: string,
    blockHash: string | undefined,
    blockNumber: number | undefined
): Promise<CoinTossData | null> {
    const data = await getCoinToss(env, challengeId);
    if (!data) return null;

    // Already flipped
    if (data.status === 'flipped') {
        return data;
    }

    // Not ready yet (counterparty hasn't accepted)
    if (data.status !== 'ready') {
        return data;
    }

    // Need blockchain data to compute result
    if (!blockHash || !blockNumber) {
        return data;
    }

    // Compute and record result
    return await recordCoinTossResult(env, challengeId, blockHash, blockNumber);
}

// ============================================================================
// Fee Calculation Helpers
// ============================================================================

/**
 * Calculate fee split based on arrangement.
 *
 * @returns Object with creator and counterparty fee amounts in cents
 */
export function calculateFeeSplit(
    arrangement: FeeArrangement,
    totalFeeCents: number,
    coinTossResult?: { sponsor: CoinTossParty }
): { creatorFeeCents: number; counterpartyFeeCents: number } {
    switch (arrangement) {
        case 'creator_pays':
            return { creatorFeeCents: totalFeeCents, counterpartyFeeCents: 0 };

        case 'counterparty_pays':
            return { creatorFeeCents: 0, counterpartyFeeCents: totalFeeCents };

        case 'split':
            const half = Math.ceil(totalFeeCents / 2);
            return { creatorFeeCents: half, counterpartyFeeCents: totalFeeCents - half };

        case 'coin_toss':
            if (!coinTossResult) {
                // Not yet flipped - both hold full amount
                return { creatorFeeCents: totalFeeCents, counterpartyFeeCents: totalFeeCents };
            }
            // Sponsor pays full amount, sponsored pays nothing
            return {
                creatorFeeCents: coinTossResult.sponsor === 'creator' ? totalFeeCents : 0,
                counterpartyFeeCents: coinTossResult.sponsor === 'counterparty' ? totalFeeCents : 0,
            };

        default:
            return { creatorFeeCents: totalFeeCents, counterpartyFeeCents: 0 };
    }
}
