
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
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Wallet challenge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
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
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Wallet verify error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
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
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Funds check error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
