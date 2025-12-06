/**
 * Gatekeeper Mutual Verification HTTP Handlers
 *
 * Mutual verification with privacy-respecting asymmetry.
 * Users must verify themselves before using Gatekeeper.
 */

import { ok, err } from '../lib/http';
import { authenticateRequest } from '../middleware/auth';
import type { Env } from '../types';
import { z } from 'zod';
import {
    getProfiles,
    getProfile,
    getAllCheckTypes,
    getUserVerification,
    getActiveUserVerification,
    startVerification,
    submitWalletSignature,
    createSession,
    getSessionDetail,
    getSessionForCounterparty,
    listUserSessions,
    verifyCounterpartyCode,
    submitCounterpartyWallet,
    proceedSession,
    abortSession,
    resendVerificationCode,
} from '../gatekeeper/mutual';

// ============================================================================
// Schema Definitions
// ============================================================================

const StartVerificationSchema = z.object({
    profile_id: z.string().min(1),
    wallet_address: z.string().optional(),
    wallet_chain: z.string().optional(),
});

const SubmitWalletSchema = z.object({
    wallet_address: z.string().min(1),
    signature: z.string().min(1),
    message: z.string().min(1),
    chain: z.string().optional(),
});

const CreateSessionSchema = z.object({
    profile_id: z.string().min(1),
    counterparty_email: z.string().email(),
    title: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    required_chain: z.string().optional(),
    required_token: z.string().optional(),
    required_balance: z.string().optional(),
    required_balance_display: z.string().optional(),
    content_hash: z.string().optional(),
    file_name: z.string().optional(),
    file_size: z.number().optional(),
    file_type: z.string().optional(),
});

const VerifyCodeSchema = z.object({
    code: z.string().length(6),
});

const VerifyWalletSchema = z.object({
    wallet_address: z.string().min(1),
    signature: z.string().min(1),
    message: z.string().min(1),
});

const AbortSchema = z.object({
    reason: z.string().max(1000).optional(),
});

// ============================================================================
// GET /gatekeeper/profiles - List available profiles
// ============================================================================

export async function getProfilesHandler(
    request: Request,
    env: Env
): Promise<Response> {
    try {
        const profiles = await getProfiles(env);
        return ok({ profiles });
    } catch (e: unknown) {
        console.error('Error listing profiles:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/check-types - List all check types
// ============================================================================

export async function getCheckTypesHandler(
    request: Request,
    env: Env
): Promise<Response> {
    try {
        const checkTypes = await getAllCheckTypes(env);
        return ok({ check_types: checkTypes });
    } catch (e: unknown) {
        console.error('Error listing check types:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/verification - Get current user's verification status
// ============================================================================

export async function getVerificationHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const verification = await getUserVerification(env, userId);
        return ok({ verification });
    } catch (e: unknown) {
        console.error('Error getting verification:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/verification - Start verification
// ============================================================================

export async function postStartVerificationHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = StartVerificationSchema.parse(body);

        const verification = await startVerification(env, userId, data);
        return ok({ verification }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error starting verification:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/verification/wallet - Submit wallet signature
// ============================================================================

export async function postWalletSignatureHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = SubmitWalletSchema.parse(body);

        const verification = await submitWalletSignature(env, userId, data);
        return ok({ verification });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error submitting wallet signature:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/verification/status - Poll verification progress
// ============================================================================

export async function getVerificationStatusHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const verification = await getActiveUserVerification(env, userId);
        return ok({ verification });
    } catch (e: unknown) {
        console.error('Error getting verification status:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions - Create session
// ============================================================================

export async function postCreateSessionHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = CreateSessionSchema.parse(body);

        const session = await createSession(env, userId, data);
        return ok({ session }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error creating session:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/sessions - List user's sessions
// ============================================================================

export async function getSessionsHandler(
    request: Request,
    env: Env
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const sessions = await listUserSessions(env, userId);
        return ok({ sessions });
    } catch (e: unknown) {
        console.error('Error listing sessions:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/sessions/:id - Get session details
// ============================================================================

export async function getSessionHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const session = await getSessionDetail(env, sessionId, userId);
        return ok({ session });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error getting session:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// GET /gatekeeper/sessions/:id/info - Public session info for counterparty
// ============================================================================

export async function getSessionInfoHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    try {
        const session = await getSessionForCounterparty(env, sessionId);
        return ok({ session });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error getting session info:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions/:id/verify-code - Verify counterparty code
// ============================================================================

export async function postVerifyCodeHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    try {
        const body = await request.json();
        const data = VerifyCodeSchema.parse(body);

        const result = await verifyCounterpartyCode(env, sessionId, data);
        return ok(result);
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error verifying code:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions/:id/verify-wallet - Submit counterparty wallet
// ============================================================================

export async function postVerifyWalletHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    // Optional auth - counterparty may or may not be logged in
    const authResult = await authenticateRequest(request, env);
    const userId = authResult.ok ? authResult.context.userId : null;

    try {
        const body = await request.json();
        const data = VerifyWalletSchema.parse(body);

        const session = await submitCounterpartyWallet(env, sessionId, userId, data);
        return ok({ session });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error verifying wallet:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions/:id/proceed - Proceed & create attestation
// ============================================================================

export async function postProceedHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const session = await proceedSession(env, sessionId, userId);
        return ok({ session });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error proceeding:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions/:id/abort - Abort session
// ============================================================================

export async function postAbortHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json().catch(() => ({}));
        const data = AbortSchema.parse(body);

        await abortSession(env, sessionId, userId, data.reason);
        return ok({ aborted: true });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error aborting:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}

// ============================================================================
// POST /gatekeeper/sessions/:id/resend - Resend verification code
// ============================================================================

export async function postResendCodeHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    try {
        await resendVerificationCode(env, sessionId);
        return ok({ sent: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const appError = e as { code: string; status?: number; message?: string };
            return err(appError.status || 400, appError.code as any, { message: appError.message });
        }
        console.error('Error resending code:', e);
        return err(500, 'INTERNAL_ERROR');
    }
}
