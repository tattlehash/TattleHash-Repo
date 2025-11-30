
import { execute } from '../../db';
import { getRpcEndpoint, CHAIN_CONFIGS } from './providers';
import { getNativeBalance, getErc20Balance } from './rpc';
import { sha256 } from '../../utils/crypto';
import { createError } from '../../errors';
import type { FundsCheckRequest, FundsCheckResponse } from './types';
import { Env } from '../../types';

export async function checkFundsThreshold(
    env: Env,
    data: FundsCheckRequest
): Promise<FundsCheckResponse> {
    const id = crypto.randomUUID();
    const checkedAt = Date.now();

    // Get RPC endpoint for the network
    const endpoint = getRpcEndpoint(data.network, env as any);
    const provider = new URL(endpoint).hostname;

    // Fetch balance based on asset type
    let balance: bigint;
    try {
        if (data.asset_type === 'NATIVE') {
            balance = await getNativeBalance(endpoint, data.wallet_address);
        } else if (data.asset_type === 'ERC20') {
            if (!data.token_address) {
                throw createError('VALIDATION_ERROR', { field: 'token_address', message: 'Required for ERC20' });
            }
            balance = await getErc20Balance(
                endpoint,
                data.token_address,
                data.wallet_address
            );
        } else {
            throw createError('VALIDATION_ERROR', { field: 'asset_type' });
        }
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) throw e;
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('RPC error:', message);
        throw createError('FUNDS_RPC_ERROR', { message });
    }

    // Compare against threshold
    const threshold = BigInt(data.min_balance);
    const passed = balance >= threshold;
    const status = passed ? 'PASSED' : 'FAILED';

    // Create privacy-preserving balance hash
    const salt = crypto.randomUUID();
    const balanceHashInput = `${balance.toString()}:${salt}`;
    const balanceHashBytes = await sha256(balanceHashInput);
    const balanceHash = Array.from(balanceHashBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Store in KV for quick access (optional, for challenge linking)
    if (data.challenge_id) {
        await env.GATE_KV.put(
            `funds_check:${id}`,
            JSON.stringify({
                status,
                balance_hash: balanceHash,
                checked_at: checkedAt,
                network: data.network,
            }),
            { expirationTtl: 3600 } // 1 hour
        );
    }

    return {
        status,
        proof_type: 'OPAQUE_V1',
        provider,
        checked_at: checkedAt,
    };
}
