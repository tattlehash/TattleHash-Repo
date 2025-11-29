
import { execute } from '../../db';
import type { WalletChallengeRequest, WalletChallengeResponse } from '../types';
import { Env } from '../../types';

const CHALLENGE_TTL_SECONDS = 600; // 10 minutes

function buildChallengeMessage(
    walletAddress: string,
    chainId: string,
    nonce: string,
    expiresAt: string
): string {
    return `TattleHash Wallet Verification

Address: ${walletAddress}
Chain: ${chainId}
Nonce: ${nonce}
Expires at: ${expiresAt}
Purpose: gatekeeper_wallet_ownership`;
}

export async function createWalletChallenge(
    env: Env,
    data: WalletChallengeRequest
): Promise<WalletChallengeResponse> {
    const id = crypto.randomUUID();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const createdAt = Date.now();
    const expiresAtTimestamp = createdAt + CHALLENGE_TTL_SECONDS * 1000;
    const expiresAt = new Date(expiresAtTimestamp).toISOString();

    // Normalize address to lowercase
    const walletAddress = data.wallet_address.toLowerCase();

    // Build the message
    const message = buildChallengeMessage(
        walletAddress,
        data.chain_id,
        nonce,
        expiresAt
    );

    // Store in D1
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO wallet_challenges (
      id, wallet_address, nonce, chain_id, created_at, expires_at, used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, walletAddress, nonce, data.chain_id, createdAt, expiresAtTimestamp, null]
    );

    // Also cache in KV for fast lookup
    await env.GATE_KV.put(
        `wallet_challenge:${id}`,
        JSON.stringify({ wallet_address: walletAddress, nonce, message, expires_at: expiresAtTimestamp }),
        { expirationTtl: CHALLENGE_TTL_SECONDS + 60 }
    );

    return {
        challenge_id: id,
        message,
        expires_at: expiresAt,
    };
}
