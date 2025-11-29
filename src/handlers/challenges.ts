
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
import { Env } from '../types';

export async function postCreateChallenge(
    request: Request,
    env: Env
): Promise<Response> {
    // Check feature flag
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json();
        const data = CreateChallengeSchema.parse(body);

        // TODO: Get user ID from auth
        const userId = 'test-user-id'; // Placeholder

        const result = await createChallenge(env, data, userId);
        return ok(result, { status: 201 });
    } catch (e: any) {
        if (e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: e.errors });
        }
        if (e.code) {
            const error = createError(e.code as any, e.details);
            return new Response(JSON.stringify({ error: error.message, ...e.details }), {
                status: error.status,
                headers: { 'content-type': 'application/json' }
            });
        }
        console.error('Challenge creation error:', e);
        return err(500, 'INTERNAL_ERROR');
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

    try {
        // TODO: Get user ID from auth
        const userId = 'test-user-id';

        const result = await sendChallenge(env, challengeId, userId);
        return ok(result);
    } catch (e: any) {
        if (e.code) {
            const error = createError(e.code as any, e.details);
            return new Response(JSON.stringify({ error: error.message, ...e.details }), {
                status: error.status,
                headers: { 'content-type': 'application/json' }
            });
        }
        console.error('Send challenge error:', e);
        return err(500, 'INTERNAL_ERROR');
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

    try {
        const body = await request.json();
        const data = AcceptChallengeSchema.parse(body);

        // TODO: Get user ID from auth
        const userId = 'test-counterparty-id';

        const result = await acceptChallenge(env, challengeId, data, userId);
        return ok(result);
    } catch (e: any) {
        if (e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: e.errors });
        }
        if (e.code) {
            const error = createError(e.code as any, e.details);
            return new Response(JSON.stringify({ error: error.message, ...e.details }), {
                status: error.status,
                headers: { 'content-type': 'application/json' }
            });
        }
        console.error('Accept challenge error:', e);
        return err(500, 'INTERNAL_ERROR');
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

    try {
        // TODO: Get user ID from auth
        const userId = 'test-user-id';

        const result = await completeChallenge(env, challengeId, userId);
        return ok(result);
    } catch (e: any) {
        if (e.code) {
            const error = createError(e.code as any, e.details);
            return new Response(JSON.stringify({ error: error.message, ...e.details }), {
                status: error.status,
                headers: { 'content-type': 'application/json' }
            });
        }
        console.error('Complete challenge error:', e);
        return err(500, 'INTERNAL_ERROR');
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
    } catch (e: any) {
        console.error('Get challenge error:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}
