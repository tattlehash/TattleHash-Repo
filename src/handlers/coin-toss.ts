/**
 * Coin Toss HTTP Handlers
 *
 * Handlers for coin toss status and verification endpoints.
 */

import type { Env } from '../types';
import { ok, err } from '../lib/http';
import {
    getCoinToss,
    verifyCoinToss,
    resolveIfReady,
    buildShareData,
} from '../coin-toss';
import { getChallengeById } from '../gatekeeper/challenges/create';
import { queryTransactionStatus } from '../anchor/service';
import { getReceipt } from '../anchor/storage';

/**
 * GET /challenges/:id/coin-toss
 *
 * Get coin toss status for a challenge.
 * If the challenge has been anchored and coin toss is ready, computes result.
 */
export async function getCoinTossStatusHandler(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    // Get challenge to verify it exists
    const challenge = await getChallengeById(env, challengeId);
    if (!challenge) {
        return err(404, 'CHALLENGE_NOT_FOUND', {
            message: 'Challenge not found',
        });
    }

    // Check if this challenge has coin toss fee arrangement
    if (challenge.fee_arrangement !== 'coin_toss') {
        return err(400, 'NOT_COIN_TOSS', {
            message: 'This challenge does not use coin toss fee arrangement',
        });
    }

    // Get coin toss data
    let coinToss = await getCoinToss(env, challengeId);
    if (!coinToss) {
        return err(404, 'COIN_TOSS_NOT_FOUND', {
            message: 'Coin toss data not found',
        });
    }

    // If coin toss is ready but not flipped, check if we have blockchain data
    if (coinToss.status === 'ready' && challenge.status === 'COMPLETED') {
        // Try to get blockchain data from the attestation
        const receipt = await getReceipt(env, challengeId);
        if (receipt?.txHash) {
            const txStatus = await queryTransactionStatus(env, receipt.txHash);
            if (txStatus.confirmed && txStatus.blockHash && txStatus.blockNumber) {
                // Resolve the coin toss
                coinToss = await resolveIfReady(
                    env,
                    challengeId,
                    txStatus.blockHash,
                    txStatus.blockNumber
                );
            }
        }
    }

    if (!coinToss) {
        return err(500, 'INTERNAL_ERROR', {
            message: 'Failed to retrieve coin toss data',
        });
    }

    // Build response
    const response: Record<string, unknown> = {
        challenge_id: challengeId,
        status: coinToss.status,
        creator_call: coinToss.creator_call,
        counterparty_call: coinToss.counterparty_call,
        fee_amount_cents: coinToss.fee_amount_cents,
        created_at: coinToss.created_at,
    };

    if (coinToss.accepted_at) {
        response.accepted_at = coinToss.accepted_at;
    }

    // Add result details if flipped
    if (coinToss.status === 'flipped' && coinToss.result) {
        response.result = coinToss.result;
        response.sponsor = coinToss.sponsor;
        response.sponsored_party = coinToss.sponsored_party;
        response.block_hash = coinToss.block_hash;
        response.block_number = coinToss.block_number;
        response.flipped_at = coinToss.flipped_at;

        // Add verification and share URLs
        const baseUrl = env.VERIFICATION_PORTAL_URL || 'https://verify.tattlehash.com';
        response.verification_url = `${baseUrl}/coin-toss/${challengeId}`;

        // Add share data
        response.share = buildShareData(
            challengeId,
            {
                sponsor: coinToss.sponsor!,
                sponsored_party: coinToss.sponsored_party!,
                fee_amount_cents: coinToss.fee_amount_cents,
                result: coinToss.result,
            },
            baseUrl
        );
    }

    return ok(response);
}

/**
 * GET /verify/coin-toss/:id
 *
 * Verify a coin toss is provably fair.
 * Public endpoint - anyone can verify.
 */
export async function getCoinTossVerificationHandler(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    // Get coin toss data
    const coinToss = await getCoinToss(env, challengeId);
    if (!coinToss) {
        return err(404, 'COIN_TOSS_NOT_FOUND', {
            message: 'Coin toss not found for this challenge',
        });
    }

    // Check if flipped
    if (coinToss.status !== 'flipped') {
        return err(400, 'COIN_TOSS_NOT_FLIPPED', {
            message: 'Coin toss has not been completed yet',
            status: coinToss.status,
        });
    }

    // Verify the result
    const verification = verifyCoinToss(coinToss);

    return ok({
        challenge_id: challengeId,
        verified: verification.valid,
        verification: {
            valid: verification.valid,
            inputs: verification.inputs,
            computation: {
                first_byte: verification.computation.first_byte_hex,
                first_byte_value: verification.computation.first_byte_int,
                modulo_2: verification.computation.modulo_2,
                computed_result: verification.computation.computed_result,
            },
            recorded_result: verification.recorded_result,
            match: verification.match,
        },
        coin_toss: {
            creator_call: coinToss.creator_call,
            counterparty_call: coinToss.counterparty_call,
            result: coinToss.result,
            sponsor: coinToss.sponsor,
            sponsored_party: coinToss.sponsored_party,
            fee_amount_cents: coinToss.fee_amount_cents,
            flipped_at: coinToss.flipped_at,
        },
        blockchain: {
            block_hash: coinToss.block_hash,
            block_number: coinToss.block_number,
            explorer_url: `https://polygonscan.com/block/${coinToss.block_number}`,
        },
        message: verification.valid
            ? 'Coin toss result is verified as provably fair'
            : 'WARNING: Recorded result does not match computed result from block hash',
    });
}
