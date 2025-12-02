/**
 * Coin Toss HTTP Handlers
 */

import type { Env } from '../types';
import { ok, err } from '../lib/http';
import { getCoinToss, verifyCoinToss } from './service';
import type { CoinTossVerification } from './types';

/**
 * GET /api/verify/coin-toss/:challengeId
 *
 * Verify that a coin toss result is provably fair.
 * Anyone can call this endpoint to verify the randomness.
 */
export async function getCoinTossVerification(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    // Get coin toss data
    const coinToss = await getCoinToss(env, challengeId);

    if (!coinToss) {
        return err(404, 'COIN_TOSS_NOT_FOUND', {
            message: 'No coin toss found for this challenge',
        });
    }

    // Check if flip has happened
    if (coinToss.status !== 'flipped') {
        return err(400, 'COIN_TOSS_NOT_FLIPPED', {
            message: 'Coin toss has not been flipped yet',
            status: coinToss.status,
        });
    }

    // Verify the result
    const verification = verifyCoinToss(coinToss);

    return ok({
        challenge_id: challengeId,
        verification,
        coin_toss: {
            creator_call: coinToss.creator_call,
            counterparty_call: coinToss.counterparty_call,
            result: coinToss.result,
            sponsor: coinToss.sponsor,
            sponsored_party: coinToss.sponsored_party,
            fee_amount_cents: coinToss.fee_amount_cents,
            flipped_at: coinToss.flipped_at,
        },
    });
}

/**
 * GET /api/challenge/:challengeId/coin-toss
 *
 * Get coin toss status and details for a challenge.
 * Used by the frontend to show current state.
 */
export async function getCoinTossStatus(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    const coinToss = await getCoinToss(env, challengeId);

    if (!coinToss) {
        return err(404, 'COIN_TOSS_NOT_FOUND', {
            message: 'No coin toss found for this challenge',
        });
    }

    // Build response based on status
    const response: Record<string, unknown> = {
        challenge_id: challengeId,
        status: coinToss.status,
        creator_call: coinToss.creator_call,
        counterparty_call: coinToss.counterparty_call,
        fee_amount_cents: coinToss.fee_amount_cents,
        created_at: coinToss.created_at,
    };

    // Add acceptance time if accepted
    if (coinToss.accepted_at) {
        response.accepted_at = coinToss.accepted_at;
    }

    // Add result details if flipped
    if (coinToss.status === 'flipped') {
        response.result = coinToss.result;
        response.sponsor = coinToss.sponsor;
        response.sponsored_party = coinToss.sponsored_party;
        response.block_hash = coinToss.block_hash;
        response.block_number = coinToss.block_number;
        response.flipped_at = coinToss.flipped_at;

        // Include verification URL
        const verificationUrl = `${env.VERIFICATION_PORTAL_URL || 'https://verify.tattlehash.com'}/coin-toss/${challengeId}`;
        response.verification_url = verificationUrl;
    }

    return ok(response);
}

/**
 * Build share text for social sharing.
 */
export function buildShareText(
    isCreator: boolean,
    isSponsor: boolean,
    feeAmountCents: number,
    verificationUrl: string
): { text: string; hashtags: string[] } {
    const feeFormatted = `$${(feeAmountCents / 100).toFixed(2)}`;

    if (isSponsor) {
        return {
            text: `I'm sponsoring a ${feeFormatted} attestation on @TattleHash after a blockchain coin toss. Provably fair, on-chain verified. ${verificationUrl}`,
            hashtags: ['TattleHash', 'BlockchainFair'],
        };
    } else {
        return {
            text: `My attestation was sponsored after a blockchain coin toss on @TattleHash! Provably fair randomness. ${verificationUrl}`,
            hashtags: ['TattleHash', 'Sponsored'],
        };
    }
}

/**
 * Build share data for the frontend.
 */
export function buildShareData(
    challengeId: string,
    coinToss: {
        sponsor: string;
        sponsored_party: string;
        fee_amount_cents: number;
        result: string;
    },
    baseUrl: string
): {
    sponsor_share: { text: string; url: string };
    sponsored_share: { text: string; url: string };
} {
    const verificationUrl = `${baseUrl}/coin-toss/${challengeId}`;
    const feeFormatted = `$${(coinToss.fee_amount_cents / 100).toFixed(2)}`;

    return {
        sponsor_share: {
            text: `I'm sponsoring a ${feeFormatted} attestation on @TattleHash after a blockchain coin toss. Provably fair, on-chain verified. #TattleHash`,
            url: verificationUrl,
        },
        sponsored_share: {
            text: `My attestation was sponsored after a blockchain coin toss on @TattleHash! Provably fair randomness. #TattleHash #Sponsored`,
            url: verificationUrl,
        },
    };
}
