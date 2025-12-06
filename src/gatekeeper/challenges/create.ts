
import { execute, queryOne } from '../../db';
import { createError } from '../../errors';
import { emitEvent } from '../../relay';
import { initializeCoinToss } from '../../coin-toss';
import { makeReceipt } from '../../models/receipt';
import { enqueue } from '../../jobs/queue';
import { recKey } from '../../lib/kv';
import type { Challenge, CreateChallengeInput } from './types';
import { Env } from '../../types';

export async function createChallenge(
    env: Env,
    input: CreateChallengeInput,
    creatorUserId: string
): Promise<Challenge> {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    // Validate mode-specific requirements
    validateModeRequirements(input);

    // Validate fee arrangement requirements
    validateFeeArrangement(input);

    // Determine fee arrangement (default to creator_pays)
    const feeArrangement = input.fee_arrangement ?? 'creator_pays';

    // For SOLO mode with content_hash, create an attestation receipt and queue for anchoring
    let receiptId: string | null = null;
    if (input.mode === 'SOLO' && input.content_hash) {
        const receipt = makeReceipt(env, input.content_hash);
        receiptId = receipt.id;

        // Store receipt in KV for anchoring
        await env.ATT_KV.put(recKey(env, receipt.id), JSON.stringify(receipt));

        // Queue for blockchain anchoring
        await enqueue(env, { type: 'anchor', id: crypto.randomUUID(), receiptId: receipt.id });

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'challenge_anchoring_queued',
            challenge_id: id,
            receipt_id: receipt.id,
            content_hash: input.content_hash,
        }));
    }

    // Insert challenge
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges (
      id, mode, creator_user_id, counterparty_user_id, counterparty_email, custom_note,
      title, description, content_hash, file_name, file_size,
      status, expires_at, created_at, updated_at, fee_arrangement, receipt_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            input.mode,
            creatorUserId,
            input.counterparty_user_id ?? null,
            input.counterparty_email ?? null,
            input.custom_note ?? null,
            input.title,
            input.description ?? null,
            input.content_hash ?? null,
            input.file_name ?? null,
            input.file_size ?? null,
            'DRAFT',
            input.expires_at ?? null,
            createdAt,
            createdAt,
            feeArrangement,
            receiptId,
        ]
    );

    // Insert gatekeeper requirements if provided
    if (input.gatekeeper_requirements) {
        await insertGatekeeperRequirements(env, id, creatorUserId, input.gatekeeper_requirements);
    }

    // Initialize coin toss if fee arrangement is coin_toss
    if (feeArrangement === 'coin_toss' && input.coin_toss_call) {
        await initializeCoinToss(env, id, input.coin_toss_call);
    }

    const challenge = await getChallengeById(env, id);

    if (!challenge) {
        throw createError('INTERNAL_ERROR');
    }

    // Emit event
    await emitEvent(env, {
        type: 'challenge.created',
        challenge_id: id,
        data: challenge
    });

    return challenge;
}

function validateModeRequirements(input: CreateChallengeInput): void {
    if (input.mode === 'SOLO' && input.counterparty_user_id) {
        throw createError('VALIDATION_ERROR', {
            field: 'counterparty_user_id',
            message: 'SOLO mode cannot have a counterparty'
        });
    }

    if (input.mode !== 'SOLO' && !input.counterparty_user_id) {
        throw createError('VALIDATION_ERROR', {
            field: 'counterparty_user_id',
            message: 'Counterparty required for non-SOLO modes'
        });
    }
}

function validateFeeArrangement(input: CreateChallengeInput): void {
    // Fee arrangement only applies to GATEKEEPER and ENFORCED modes
    if (input.fee_arrangement && !['GATEKEEPER', 'ENFORCED'].includes(input.mode)) {
        throw createError('VALIDATION_ERROR', {
            field: 'fee_arrangement',
            message: 'Fee arrangement only applies to GATEKEEPER and ENFORCED modes'
        });
    }

    // If coin_toss is selected, must provide a call
    if (input.fee_arrangement === 'coin_toss' && !input.coin_toss_call) {
        throw createError('VALIDATION_ERROR', {
            field: 'coin_toss_call',
            message: 'Must choose heads or tails when using coin toss fee arrangement'
        });
    }

    // If coin_toss_call is provided, fee_arrangement must be coin_toss
    if (input.coin_toss_call && input.fee_arrangement !== 'coin_toss') {
        throw createError('VALIDATION_ERROR', {
            field: 'coin_toss_call',
            message: 'Coin toss call only valid with coin_toss fee arrangement'
        });
    }
}

async function insertGatekeeperRequirements(
    env: Env,
    challengeId: string,
    creatorUserId: string,
    requirements: CreateChallengeInput['gatekeeper_requirements']
): Promise<void> {
    if (!requirements) return;

    const insertFundsRequirement = async (
        userId: string,
        wallet: string,
        network: string,
        check: { asset_type: string; token_address?: string; min_balance: string; currency_symbol: string }
    ) => {
        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO funds_requirements (
        id, challenge_id, user_id, wallet_address, network,
        asset_type, token_address, min_balance, currency_symbol, snapshot_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                crypto.randomUUID(),
                challengeId,
                userId,
                wallet.toLowerCase(),
                network,
                check.asset_type,
                check.token_address ?? null,
                check.min_balance,
                check.currency_symbol,
                'AT_INTENT_LOCK',
            ]
        );
    };

    // Creator requirements
    if (requirements.creator) {
        for (const check of requirements.creator.funds_checks || []) {
            await insertFundsRequirement(
                creatorUserId,
                requirements.creator.wallet_address,
                requirements.creator.network,
                check
            );
        }
    }

    // Counterparty requirements (use placeholder, will be updated on acceptance)
    if (requirements.counterparty) {
        for (const check of requirements.counterparty.funds_checks || []) {
            await insertFundsRequirement(
                'COUNTERPARTY_PLACEHOLDER',
                requirements.counterparty.wallet_address,
                requirements.counterparty.network,
                check
            );
        }
    }
}

export async function getChallengeById(env: Env, id: string): Promise<Challenge | null> {
    return queryOne<Challenge>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges WHERE id = ?',
        [id]
    );
}
