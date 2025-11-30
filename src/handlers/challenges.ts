
import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { getFlag } from '../lib/flags';
import {
    createChallenge,
    getChallengeById,
    sendChallenge,
    acceptChallenge,
    completeChallenge
} from '../gatekeeper/challenges';
import { CreateChallengeSchema, AcceptChallengeSchema } from '../utils/validation';
import { getCachedChallenge, setCachedChallenge, invalidateChallengeCache } from '../lib/cache';
import { authenticateRequest } from '../middleware/auth';
import { Env } from '../types';

export async function postCreateChallenge(
    request: Request,
    env: Env
): Promise<Response> {
    // Check feature flag
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    // Authenticate user
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = CreateChallengeSchema.parse(body);

        const result = await createChallenge(env, data, userId);
        return ok(result, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Challenge creation error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function postSendChallenge(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    // Authenticate user
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await sendChallenge(env, challengeId, userId);
        return ok(result);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Send challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function postAcceptChallenge(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    // Authenticate user
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = AcceptChallengeSchema.parse(body);

        const result = await acceptChallenge(env, challengeId, data, userId);
        return ok(result);
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Accept challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function postCompleteChallenge(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    // Authenticate user
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await completeChallenge(env, challengeId, userId);
        return ok(result);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Complete challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function getChallenge(
    request: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        // Try cache first
        let result = await getCachedChallenge(env, challengeId);

        if (!result) {
            // Cache miss, get from database
            result = await getChallengeById(env, challengeId);

            if (result) {
                // Cache for future requests
                await setCachedChallenge(env, result);
            }
        }

        if (!result) {
            return err(404, 'CHALLENGE_NOT_FOUND');
        }

        return ok(result);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
