/**
 * Account Management Handlers
 *
 * Handles user registration, login, profile management, and password reset.
 * Supports both email/password and wallet-based authentication.
 */

import { ok, err } from '../lib/http';
import { Env } from '../types';
import { execute, query, queryOne } from '../db';
import {
    generateToken,
    hashPassword,
    verifyPassword,
    validatePassword,
    validateEmail,
    validateUsername,
    generateSecureToken,
    hashToken,
    getUserByWallet,
    getOrCreateUser,
} from '../auth';
import { authenticateRequest } from '../middleware/auth';
import { getCreditSummary } from '../credits';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

const RegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    display_name: z.string().max(100).optional(),
});

const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

const WalletLoginSchema = z.object({
    wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    signature: z.string(),
    message: z.string(),
});

const VerifyEmailSchema = z.object({
    token: z.string().length(64),
});

const ForgotPasswordSchema = z.object({
    email: z.string().email(),
});

const ResetPasswordSchema = z.object({
    token: z.string().length(64),
    new_password: z.string().min(8).max(128),
});

const UpdateProfileSchema = z.object({
    display_name: z.string().max(100).optional(),
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    profile_image_url: z.string().url().optional(),
});

const UpdatePreferencesSchema = z.object({
    notifications: z.object({
        email: z.boolean().optional(),
        webhook: z.boolean().optional(),
    }).optional(),
    llm_provider: z.enum(['openai', 'anthropic', 'local']).optional(),
    default_monitoring_mode: z.enum(['PASSIVE', 'ACTIVE', 'STRICT']).optional(),
});

const LinkWalletSchema = z.object({
    wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    signature: z.string(),
    message: z.string(),
});

// ============================================================================
// Types
// ============================================================================

interface UserRow {
    id: string;
    email: string | null;
    username: string | null;
    display_name: string | null;
    wallet_address: string | null;
    email_verified: number;
    auth_method: string;
    profile_image_url: string | null;
    preferences: string;
    created_at: number;
    updated_at: number;
    last_login_at: number | null;
    login_count: number;
}

// ============================================================================
// Registration & Login
// ============================================================================

/**
 * POST /auth/register
 * Create account with email/password
 */
export async function postRegister(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const { email, password, username, display_name } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Validate password strength
    const passwordError = validatePassword(password);
    if (passwordError) {
        return err(400, 'VALIDATION_ERROR', { message: passwordError });
    }

    // Validate username if provided
    if (username) {
        const usernameError = validateUsername(username);
        if (usernameError) {
            return err(400, 'VALIDATION_ERROR', { message: usernameError });
        }
    }

    // Check if email already exists
    const existingEmail = await queryOne<{ id: string }>(
        env.TATTLEHASH_DB,
        'SELECT id FROM users WHERE email = ?',
        [normalizedEmail]
    );
    if (existingEmail) {
        return err(409, 'EMAIL_EXISTS', { message: 'An account with this email already exists' });
    }

    // Check if username already exists
    if (username) {
        const existingUsername = await queryOne<{ id: string }>(
            env.TATTLEHASH_DB,
            'SELECT id FROM users WHERE username = ?',
            [username.toLowerCase()]
        );
        if (existingUsername) {
            return err(409, 'USERNAME_EXISTS', { message: 'This username is already taken' });
        }
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationTokenHash = await hashToken(verificationToken);
    const verificationExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const userId = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO users (
            id, email, username, display_name, password_hash, auth_method,
            email_verification_token, email_verification_expires_at,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            normalizedEmail,
            username?.toLowerCase() ?? null,
            display_name ?? null,
            passwordHash,
            'email',
            verificationTokenHash,
            verificationExpires,
            now,
            now,
        ]
    );

    // Log verification token (in production, send email)
    console.log(JSON.stringify({
        t: now,
        at: 'email_verification_token_created',
        user_id: userId,
        email: normalizedEmail,
        token: verificationToken, // In production: send via email, don't log
        expires_at: new Date(verificationExpires).toISOString(),
    }));

    return ok({
        user_id: userId,
        message: 'Account created. Please check your email to verify your account.',
        // Include token in response for development/testing
        verification_token: env.NODE_ENV !== 'production' ? verificationToken : undefined,
    }, { status: 201 });
}

/**
 * POST /auth/login
 * Login with email/password
 */
export async function postLogin(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Find user
    const user = await queryOne<UserRow & { password_hash: string }>(
        env.TATTLEHASH_DB,
        `SELECT id, email, username, display_name, wallet_address, password_hash,
                email_verified, auth_method, profile_image_url, preferences,
                created_at, updated_at, last_login_at, login_count
         FROM users WHERE email = ?`,
        [normalizedEmail]
    );

    if (!user || !user.password_hash) {
        return err(401, 'INVALID_CREDENTIALS', { message: 'Invalid email or password' });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
        return err(401, 'INVALID_CREDENTIALS', { message: 'Invalid email or password' });
    }

    // Check email verification
    if (!user.email_verified) {
        return err(403, 'EMAIL_NOT_VERIFIED', {
            message: 'Please verify your email before logging in',
        });
    }

    // Update login stats
    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?',
        [now, user.id]
    );

    // Generate token
    const token = await generateToken(env, user.id, user.wallet_address ?? `email:${user.email}`);

    return ok({
        token: token.token,
        expires_at: token.expires_at,
        user: {
            id: user.id,
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            wallet_address: user.wallet_address,
            auth_method: user.auth_method,
            email_verified: Boolean(user.email_verified),
        },
    });
}

/**
 * POST /auth/login/wallet
 * Login with wallet signature (Web3)
 */
export async function postWalletLogin(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = WalletLoginSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const { wallet_address, signature, message } = parsed.data;
    const normalizedAddress = wallet_address.toLowerCase();

    // Verify signature using existing wallet verification
    const { recoverAddressFromSignature } = await import('../gatekeeper/wallet/recovery');

    let recoveredAddress: string;
    try {
        recoveredAddress = await recoverAddressFromSignature(message, signature);
    } catch (e) {
        return err(401, 'INVALID_SIGNATURE', { message: 'Invalid wallet signature' });
    }

    if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        return err(401, 'INVALID_SIGNATURE', { message: 'Signature does not match wallet address' });
    }

    // Get or create user
    const { user, created } = await getOrCreateUser(env, normalizedAddress);

    // Update login stats
    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?',
        [now, user.id]
    );

    // Generate token
    const token = await generateToken(env, user.id, normalizedAddress);

    // Get full user data
    const fullUser = await queryOne<UserRow>(
        env.TATTLEHASH_DB,
        `SELECT id, email, username, display_name, wallet_address,
                email_verified, auth_method, profile_image_url, preferences,
                created_at, updated_at, last_login_at, login_count
         FROM users WHERE id = ?`,
        [user.id]
    );

    return ok({
        token: token.token,
        expires_at: token.expires_at,
        user: fullUser ? {
            id: fullUser.id,
            email: fullUser.email,
            username: fullUser.username,
            display_name: fullUser.display_name,
            wallet_address: fullUser.wallet_address,
            auth_method: fullUser.auth_method,
            email_verified: Boolean(fullUser.email_verified),
        } : null,
        user_created: created,
    });
}

/**
 * POST /auth/verify-email
 * Verify email address with token
 */
export async function postVerifyEmail(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = VerifyEmailSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const tokenHash = await hashToken(parsed.data.token);

    // Find user with this token
    const user = await queryOne<{ id: string; email_verification_expires_at: number }>(
        env.TATTLEHASH_DB,
        `SELECT id, email_verification_expires_at FROM users
         WHERE email_verification_token = ? AND email_verified = 0`,
        [tokenHash]
    );

    if (!user) {
        return err(400, 'INVALID_TOKEN', { message: 'Invalid or expired verification token' });
    }

    // Check expiry
    if (Date.now() > user.email_verification_expires_at) {
        return err(400, 'TOKEN_EXPIRED', { message: 'Verification token has expired' });
    }

    // Mark email as verified
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE users SET
            email_verified = 1,
            email_verification_token = NULL,
            email_verification_expires_at = NULL,
            updated_at = ?
         WHERE id = ?`,
        [Date.now(), user.id]
    );

    return ok({ message: 'Email verified successfully' });
}

/**
 * POST /auth/forgot-password
 * Request password reset
 */
export async function postForgotPassword(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = ForgotPasswordSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const normalizedEmail = parsed.data.email.toLowerCase();

    // Find user (don't reveal if email exists)
    const user = await queryOne<{ id: string }>(
        env.TATTLEHASH_DB,
        'SELECT id FROM users WHERE email = ?',
        [normalizedEmail]
    );

    // Always return success to prevent email enumeration
    if (!user) {
        return ok({ message: 'If an account exists with this email, a reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = generateSecureToken();
    const resetTokenHash = await hashToken(resetToken);
    const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour
    const now = Date.now();

    // Store reset token
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), user.id, resetTokenHash, expiresAt, now]
    );

    // Log token (in production, send email)
    console.log(JSON.stringify({
        t: now,
        at: 'password_reset_token_created',
        user_id: user.id,
        email: normalizedEmail,
        token: resetToken, // In production: send via email, don't log
        expires_at: new Date(expiresAt).toISOString(),
    }));

    return ok({
        message: 'If an account exists with this email, a reset link has been sent.',
        // Include token in response for development/testing
        reset_token: env.NODE_ENV !== 'production' ? resetToken : undefined,
    });
}

/**
 * POST /auth/reset-password
 * Reset password with token
 */
export async function postResetPassword(req: Request, env: Env): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = ResetPasswordSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const { token, new_password } = parsed.data;

    // Validate password strength
    const passwordError = validatePassword(new_password);
    if (passwordError) {
        return err(400, 'VALIDATION_ERROR', { message: passwordError });
    }

    const tokenHash = await hashToken(token);

    // Find valid reset token
    const resetToken = await queryOne<{ id: string; user_id: string; expires_at: number }>(
        env.TATTLEHASH_DB,
        `SELECT id, user_id, expires_at FROM password_reset_tokens
         WHERE token_hash = ? AND used_at IS NULL`,
        [tokenHash]
    );

    if (!resetToken) {
        return err(400, 'INVALID_TOKEN', { message: 'Invalid or expired reset token' });
    }

    if (Date.now() > resetToken.expires_at) {
        return err(400, 'TOKEN_EXPIRED', { message: 'Reset token has expired' });
    }

    // Hash new password
    const passwordHash = await hashPassword(new_password);
    const now = Date.now();

    // Update password and mark token as used
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
        [passwordHash, now, resetToken.user_id]
    );

    await execute(
        env.TATTLEHASH_DB,
        'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?',
        [now, resetToken.id]
    );

    return ok({ message: 'Password reset successfully' });
}

// ============================================================================
// Profile Management
// ============================================================================

/**
 * GET /auth/me
 * Get current user profile
 */
export async function getMe(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const { userId } = authResult.context;

    // Get user with all profile fields
    const user = await queryOne<UserRow>(
        env.TATTLEHASH_DB,
        `SELECT id, email, username, display_name, wallet_address,
                email_verified, auth_method, profile_image_url, preferences,
                created_at, updated_at, last_login_at, login_count
         FROM users WHERE id = ?`,
        [userId]
    );

    if (!user) {
        return err(404, 'NOT_FOUND', { resource: 'user' });
    }

    // Get credits balance
    let credits = null;
    try {
        const summary = await getCreditSummary(env, userId);
        credits = {
            balance: summary.total_available,
            tier: summary.loyalty_tier,
            total_earned: summary.lifetime_credits_earned,
            pending_holds: summary.total_pending,
        };
    } catch {
        // Credits not available
    }

    // Get linked wallets
    const linkedWallets = await query<{ wallet_address: string; is_primary: number; linked_at: number }>(
        env.TATTLEHASH_DB,
        'SELECT wallet_address, is_primary, linked_at FROM linked_wallets WHERE user_id = ?',
        [userId]
    );

    return ok({
        id: user.id,
        email: user.email,
        username: user.username,
        display_name: user.display_name,
        wallet_address: user.wallet_address,
        auth_method: user.auth_method,
        email_verified: Boolean(user.email_verified),
        profile_image_url: user.profile_image_url,
        preferences: JSON.parse(user.preferences || '{}'),
        created_at: new Date(user.created_at).toISOString(),
        updated_at: new Date(user.updated_at).toISOString(),
        last_login_at: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
        login_count: user.login_count,
        credits,
        linked_wallets: linkedWallets.map(w => ({
            wallet_address: w.wallet_address,
            is_primary: Boolean(w.is_primary),
            linked_at: new Date(w.linked_at).toISOString(),
        })),
    });
}

/**
 * PATCH /auth/profile
 * Update user profile
 */
export async function patchProfile(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const { userId } = authResult.context;

    const body = await req.json() as Record<string, unknown>;
    const parsed = UpdateProfileSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const updates = parsed.data;
    const updateFields: string[] = [];
    const updateValues: (string | number)[] = [];

    if (updates.display_name !== undefined) {
        updateFields.push('display_name = ?');
        updateValues.push(updates.display_name);
    }

    if (updates.username !== undefined) {
        // Check if username is taken
        const existing = await queryOne<{ id: string }>(
            env.TATTLEHASH_DB,
            'SELECT id FROM users WHERE username = ? AND id != ?',
            [updates.username.toLowerCase(), userId]
        );
        if (existing) {
            return err(409, 'USERNAME_EXISTS', { message: 'This username is already taken' });
        }
        updateFields.push('username = ?');
        updateValues.push(updates.username.toLowerCase());
    }

    if (updates.profile_image_url !== undefined) {
        updateFields.push('profile_image_url = ?');
        updateValues.push(updates.profile_image_url);
    }

    if (updateFields.length === 0) {
        return err(400, 'VALIDATION_ERROR', { message: 'No fields to update' });
    }

    updateFields.push('updated_at = ?');
    updateValues.push(Date.now());
    updateValues.push(userId);

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
    );

    return ok({ message: 'Profile updated successfully' });
}

/**
 * GET /auth/preferences
 * Get user preferences
 */
export async function getPreferences(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const user = await queryOne<{ preferences: string }>(
        env.TATTLEHASH_DB,
        'SELECT preferences FROM users WHERE id = ?',
        [authResult.context.userId]
    );

    return ok(JSON.parse(user?.preferences || '{}'));
}

/**
 * PATCH /auth/preferences
 * Update user preferences
 */
export async function patchPreferences(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const { userId } = authResult.context;

    const body = await req.json() as Record<string, unknown>;
    const parsed = UpdatePreferencesSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    // Get current preferences
    const user = await queryOne<{ preferences: string }>(
        env.TATTLEHASH_DB,
        'SELECT preferences FROM users WHERE id = ?',
        [userId]
    );

    const currentPrefs = JSON.parse(user?.preferences || '{}');
    const newPrefs = { ...currentPrefs, ...parsed.data };

    await execute(
        env.TATTLEHASH_DB,
        'UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(newPrefs), Date.now(), userId]
    );

    return ok(newPrefs);
}

/**
 * POST /auth/link-wallet
 * Link a wallet to existing email account
 */
export async function postLinkWallet(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const { userId } = authResult.context;

    const body = await req.json() as Record<string, unknown>;
    const parsed = LinkWalletSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const { wallet_address, signature, message } = parsed.data;
    const normalizedAddress = wallet_address.toLowerCase();

    // Verify signature
    const { recoverAddressFromSignature } = await import('../gatekeeper/wallet/recovery');

    let recoveredAddress: string;
    try {
        recoveredAddress = await recoverAddressFromSignature(message, signature);
    } catch (e) {
        return err(401, 'INVALID_SIGNATURE', { message: 'Invalid wallet signature' });
    }

    if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        return err(401, 'INVALID_SIGNATURE', { message: 'Signature does not match wallet address' });
    }

    // Check if wallet is already linked to another user
    const existingUser = await getUserByWallet(env, normalizedAddress);
    if (existingUser && existingUser.id !== userId) {
        return err(409, 'WALLET_ALREADY_LINKED', {
            message: 'This wallet is already linked to another account',
        });
    }

    const now = Date.now();

    // Check if this is the first wallet being linked
    const existingWallets = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        'SELECT id FROM linked_wallets WHERE user_id = ?',
        [userId]
    );

    const isPrimary = existingWallets.length === 0 ? 1 : 0;

    // Link wallet
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO linked_wallets (id, user_id, wallet_address, linked_at, verified_at, is_primary)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet_address) DO UPDATE SET verified_at = ?, is_primary = ?`,
        [crypto.randomUUID(), userId, normalizedAddress, now, now, isPrimary, now, isPrimary]
    );

    // Update user's primary wallet if this is first
    if (isPrimary) {
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE users SET wallet_address = ?, auth_method = 'both', updated_at = ? WHERE id = ?`,
            [normalizedAddress, now, userId]
        );
    }

    return ok({
        message: 'Wallet linked successfully',
        wallet_address: normalizedAddress,
        is_primary: Boolean(isPrimary),
    });
}

/**
 * POST /auth/logout
 * Invalidate current session
 */
export async function postLogout(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        // Already not authenticated
        return ok({ message: 'Logged out' });
    }

    // Since we use stateless JWTs, we can't truly invalidate them
    // In a full implementation, you'd add the token to a blacklist in KV/Redis
    // For now, just acknowledge the logout

    return ok({ message: 'Logged out successfully' });
}
