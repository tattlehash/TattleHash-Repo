
import { execute, queryOne } from '../../db';
import { createError } from '../../errors';
import { emitEvent } from '../../relay';
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

    // Insert challenge
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenges (
      id, mode, creator_user_id, counterparty_user_id,
      title, description, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            input.mode,
            creatorUserId,
            input.counterparty_user_id ?? null,
            input.title,
            input.description ?? null,
            'DRAFT',
            input.expires_at ?? null,
            createdAt,
            createdAt,
        ]
    );

    // Insert gatekeeper requirements if provided
    if (input.gatekeeper_requirements) {
        await insertGatekeeperRequirements(env, id, creatorUserId, input.gatekeeper_requirements);
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
