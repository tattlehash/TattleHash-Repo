/**
 * Authentication middleware for extracting and validating user context.
 */

import { verifyToken, extractBearerToken, getUserById, type TokenPayload, type User } from '../auth';
import { createError } from '../errors';
import type { Env } from '../types';

/**
 * User context extracted from authentication.
 */
export interface UserContext {
    userId: string;
    walletAddress: string;
    user: User;
}

/**
 * Result of authentication attempt.
 */
export type AuthResult =
    | { ok: true; context: UserContext }
    | { ok: false; error: ReturnType<typeof createError> };

/**
 * Extract and validate user authentication from request.
 * Returns user context if authenticated, error if not.
 */
export async function authenticateRequest(
    request: Request,
    env: Env
): Promise<AuthResult> {
    // Extract bearer token
    const token = extractBearerToken(request);
    if (!token) {
        return {
            ok: false,
            error: createError('UNAUTHORIZED', { reason: 'Missing authorization header' }),
        };
    }

    // Verify token
    const payload = await verifyToken(env, token);
    if (!payload) {
        return {
            ok: false,
            error: createError('UNAUTHORIZED', { reason: 'Invalid or expired token' }),
        };
    }

    // Get user from database to ensure they still exist
    const user = await getUserById(env, payload.sub);
    if (!user) {
        return {
            ok: false,
            error: createError('UNAUTHORIZED', { reason: 'User not found' }),
        };
    }

    return {
        ok: true,
        context: {
            userId: user.id,
            walletAddress: user.wallet_address,
            user,
        },
    };
}

/**
 * Require authentication middleware.
 * Returns Response if auth fails, null if auth succeeds.
 * On success, caller should use authenticateRequest to get context.
 */
export async function requireAuth(
    request: Request,
    env: Env
): Promise<Response | null> {
    const result = await authenticateRequest(request, env);

    if (!result.ok) {
        return new Response(
            JSON.stringify({
                ok: false,
                error: result.error.code,
                details: { message: result.error.message, ...result.error.details },
            }),
            {
                status: result.error.status,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    return null;
}

/**
 * Get authenticated user context.
 * Throws if not authenticated - use after requireAuth succeeds.
 */
export async function getAuthContext(
    request: Request,
    env: Env
): Promise<UserContext> {
    const result = await authenticateRequest(request, env);
    if (!result.ok) {
        throw result.error;
    }
    return result.context;
}

/**
 * Try to authenticate request without requiring it.
 * Returns user context if authenticated, null if not.
 * Use for endpoints that work for both authenticated and anonymous users.
 */
export async function tryAuthenticate(
    request: Request,
    env: Env
): Promise<UserContext | null> {
    const result = await authenticateRequest(request, env);
    if (!result.ok) {
        return null;
    }
    return result.context;
}
