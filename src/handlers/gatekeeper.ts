
import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { getFlag } from '../lib/flags';
import { createWalletChallenge, verifyWalletSignature, checkFundsThreshold } from '../gatekeeper';
import { Env } from '../types';
import { WalletChallengeSchema, WalletVerifySchema, FundsCheckSchema } from '../utils/validation';

export async function postWalletChallenge(
    request: Request,
    env: Env
): Promise<Response> {
    // Check feature flag
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json();
        const data = WalletChallengeSchema.parse(body);
        const result = await createWalletChallenge(env, data);
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
        console.error('Wallet challenge error:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

export async function postWalletVerify(
    request: Request,
    env: Env
): Promise<Response> {
    // Check feature flag
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json();
        const data = WalletVerifySchema.parse(body);
        const result = await verifyWalletSignature(env, data);
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
        console.error('Wallet verify error:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

export async function postFundsCheck(
    request: Request,
    env: Env
): Promise<Response> {
    // Check feature flag
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json();
        const data = FundsCheckSchema.parse(body);
        const result = await checkFundsThreshold(env, data);
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
        console.error('Funds check error:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}
