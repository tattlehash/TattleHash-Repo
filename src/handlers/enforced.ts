/**
 * Enforced Mode HTTP Handlers
 *
 * Endpoints for full escrow transactions with threshold verification.
 */

import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { getFlag } from '../lib/flags';
import { authenticateRequest } from '../middleware/auth';
import { Env } from '../types';
import {
    createEnforcedChallenge,
    depositEnforcedStake,
    acceptEnforcedChallenge,
    completeEnforcedChallenge,
    raiseEnforcedDispute,
    resolveEnforcedDispute,
    handleEnforcedTimeout,
    getEnforcedChallengeStatus,
} from '../gatekeeper/modes/enforced';
import {
    CreateEnforcedChallengeSchema,
    DepositStakeSchema,
} from '../gatekeeper/stakes/types';
import { z } from 'zod';

// ============================================================================
// Schema Definitions
// ============================================================================

const RaiseDisputeSchema = z.object({
    reason: z.string().min(1).max(2000),
    evidence: z.record(z.string(), z.unknown()).optional(),
});

const ResolveDisputeSchema = z.object({
    winner_user_id: z.string().uuid(),
    resolution: z.string().min(1).max(2000),
});

// ============================================================================
// POST /enforced/challenges - Create Enforced Challenge
// ============================================================================

export async function postCreateEnforcedChallenge(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = CreateEnforcedChallengeSchema.parse(body);

        const result = await createEnforcedChallenge(env, data, userId);

        return ok({
            challenge: result.challenge,
            thresholds: result.thresholds,
            traffic_light: result.trafficLight,
        }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Create enforced challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/stake - Deposit Stake
// ============================================================================

export async function postDepositStake(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();

        // Validate required fields for stake deposit
        const stakeData = z.object({
            wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
            chain_id: z.string().regex(/^eip155:\d+$/),
            token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
            tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
            amount: z.string().regex(/^\d+$/),
            currency_code: z.string().min(1).max(10),
        }).parse(body);

        const result = await depositEnforcedStake(env, challengeId, userId, stakeData);

        return ok({
            stake: result.stake,
            traffic_light: result.trafficLight,
        });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Deposit stake error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/accept - Accept Challenge
// ============================================================================

export async function postAcceptEnforced(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await acceptEnforcedChallenge(env, challengeId, userId);

        return ok({
            challenge: result.challenge,
            traffic_light: result.trafficLight,
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Accept enforced challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/complete - Mark Completion
// ============================================================================

export async function postCompleteEnforced(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await completeEnforcedChallenge(env, challengeId, userId);

        return ok({
            challenge: result.challenge,
            traffic_light: result.trafficLight,
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Complete enforced challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/dispute - Raise Dispute
// ============================================================================

export async function postRaiseDispute(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = RaiseDisputeSchema.parse(body);

        const challenge = await raiseEnforcedDispute(env, challengeId, userId, data.reason, data.evidence);

        return ok({ challenge });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Raise dispute error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/resolve - Resolve Dispute (Admin)
// ============================================================================

export async function postResolveDispute(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    // This should be admin-only in production
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    try {
        const body = await request.json();
        const data = ResolveDisputeSchema.parse(body);

        const result = await resolveEnforcedDispute(env, challengeId, data.winner_user_id, data.resolution);

        return ok({
            challenge: result.challenge,
            traffic_light: result.trafficLight,
        });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Resolve dispute error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/challenges/:id/status - Get Full Status
// ============================================================================

export async function getEnforcedStatus(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const status = await getEnforcedChallengeStatus(env, challengeId);
        return ok(status);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get enforced status error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/challenges/:id/check-timeout - Check and Handle Timeouts
// ============================================================================

export async function postCheckTimeout(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_MODE_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const result = await handleEnforcedTimeout(env, challengeId);

        return ok({
            challenge: result.challenge,
            stakes_handled: result.stakesSlashed,
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Check timeout error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
