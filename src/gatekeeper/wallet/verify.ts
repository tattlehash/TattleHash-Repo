
import { queryOne, execute } from '../../db';
import { recoverAddressFromSignature } from './recovery';
import { createError } from '../../errors';
import { emitEvent } from '../../relay';
import { getOrCreateUser, generateToken } from '../../auth';
import type { WalletVerifyRequest, WalletVerifyResponse } from '../types';
import { Env } from '../../types';

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

    // Emit event
    await emitEvent(env, {
        type: 'wallet.verified',
        wallet_address: normalizedExpected,
        verified_at: verifiedAt,
        user_id: user.id,
        user_created: created,
    });

    return {
        status: 'VERIFIED',
        wallet_address: normalizedExpected,
        verified_at: verifiedAt,
        user_id: user.id,
        token: authToken.token,
        token_expires_at: authToken.expires_at,
    };
}
