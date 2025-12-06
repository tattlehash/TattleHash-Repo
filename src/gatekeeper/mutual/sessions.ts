/**
 * Gatekeeper Session Management
 *
 * Create and manage Gatekeeper verification sessions.
 * Requires initiator to have valid verification before creating session.
 */

import { execute, queryOne, query } from '../../db';
import { createError } from '../../errors';
import { sendEmail } from '../../email';
import type { Env } from '../../types';
import type {
    SessionRow,
    SessionCheckRow,
    SessionSummary,
    SessionDetail,
    CounterpartyViewSession,
    CreateSessionInput,
    VerifyCounterpartyCodeInput,
    VerifyCounterpartyWalletInput,
    CheckResult,
    SignalSummary,
} from './types';
import { getProfile, getProfileChecks } from './profiles';
import { hasValidVerification } from './verification';
import { logEvent } from './events';
import { runSessionCheck, calculateSignalSummary } from './checks';

// ============================================================================
// Constants
// ============================================================================

const SESSION_EXPIRY_HOURS = 72;
const VERIFICATION_CODE_EXPIRY_HOURS = 24;
const MAX_VERIFICATION_ATTEMPTS = 5;

// ============================================================================
// Create Session
// ============================================================================

export async function createSession(
    env: Env,
    initiatorUserId: string,
    input: CreateSessionInput
): Promise<SessionDetail> {
    const now = Date.now();

    // Check if initiator has valid verification
    const { valid, verification } = await hasValidVerification(env, initiatorUserId);
    if (!valid || !verification) {
        throw createError('FORBIDDEN', {
            message: 'You must complete verification before creating a Gatekeeper session',
        });
    }

    // Verify profile exists
    const profile = await getProfile(env, input.profile_id);
    if (!profile) {
        throw createError('NOT_FOUND', { message: 'Profile not found' });
    }

    // Get initiator email
    const initiator = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [initiatorUserId]
    );

    if (!initiator) {
        throw createError('NOT_FOUND', { message: 'User not found' });
    }

    // Create session
    const sessionId = `gks_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const expiresAt = now + (SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpiresAt = now + (VERIFICATION_CODE_EXPIRY_HOURS * 60 * 60 * 1000);

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO gatekeeper_sessions
         (id, profile_id, status, initiator_user_id, initiator_verification_id,
          initiator_badge_status, counterparty_email, title, description,
          required_chain, required_token, required_balance, required_balance_display,
          content_hash, file_name, file_size, file_type,
          verification_code, verification_code_expires_at, created_at, expires_at)
         VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            sessionId,
            input.profile_id,
            initiatorUserId,
            verification.id,
            verification.badge_granted,
            input.counterparty_email,
            input.title || null,
            input.description || null,
            input.required_chain || 'ethereum',
            input.required_token || 'ETH',
            input.required_balance || null,
            input.required_balance_display || null,
            input.content_hash || null,
            input.file_name || null,
            input.file_size || null,
            input.file_type || null,
            verificationCode,
            verificationCodeExpiresAt,
            now,
            expiresAt,
        ]
    );

    // Create check records for counterparty
    const checks = await getProfileChecks(env, input.profile_id);
    for (const check of checks) {
        const checkId = `gksc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO gatekeeper_session_checks
             (id, session_id, check_type_id, status, created_at)
             VALUES (?, ?, ?, 'PENDING', ?)`,
            [checkId, sessionId, check.id, now]
        );
    }

    // Send invitation email
    await sendCounterpartyInvitation(env, sessionId, input.counterparty_email, initiator.email, input.title || null, verificationCode);

    // Update status to COUNTERPARTY_INVITED
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions SET status = 'COUNTERPARTY_INVITED' WHERE id = ?`,
        [sessionId]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        event_type: 'SESSION_CREATED',
        actor_type: 'INITIATOR',
        actor_identifier: initiatorUserId,
        details: JSON.stringify({
            profile_id: input.profile_id,
            counterparty_email: input.counterparty_email,
        }),
    });

    return getSessionDetail(env, sessionId, initiatorUserId);
}

// ============================================================================
// Get Session Detail (for initiator)
// ============================================================================

export async function getSessionDetail(
    env: Env,
    sessionId: string,
    userId: string
): Promise<SessionDetail> {
    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    // Verify user is initiator
    if (session.initiator_user_id !== userId) {
        throw createError('FORBIDDEN', { message: 'Not authorized to view this session' });
    }

    const profile = await getProfile(env, session.profile_id);
    const initiator = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [session.initiator_user_id]
    );

    // Get check results
    const checkRows = await query<SessionCheckRow & { name: string }>(
        env.TATTLEHASH_DB,
        `SELECT sc.*, ct.name
         FROM gatekeeper_session_checks sc
         JOIN gatekeeper_check_types ct ON sc.check_type_id = ct.id
         WHERE sc.session_id = ?
         ORDER BY ct.sort_order`,
        [sessionId]
    );

    const checks: CheckResult[] = checkRows.map(row => ({
        check_type_id: row.check_type_id,
        check_name: row.name,
        status: row.status as any,
        signal_type: row.signal_type as any,
        signal_text: row.signal_text,
        meets_badge_threshold: null,
    }));

    return {
        id: session.id,
        title: session.title,
        description: session.description,
        status: session.status as any,
        profile_id: session.profile_id,
        profile_name: profile?.name || 'Unknown',
        initiator_user_id: session.initiator_user_id,
        initiator_email: initiator?.email || 'Unknown',
        initiator_badge_status: session.initiator_badge_status === 1,
        counterparty_email: session.counterparty_email,
        counterparty_verification_status: session.counterparty_verification_status,
        counterparty_signal_summary: session.counterparty_signal_summary as SignalSummary | null,
        counterparty_wallet_address: session.counterparty_wallet_address,
        required_chain: session.required_chain,
        required_token: session.required_token,
        required_balance: session.required_balance,
        required_balance_display: session.required_balance_display,
        content_hash: session.content_hash,
        file_name: session.file_name,
        file_size: session.file_size,
        file_type: session.file_type,
        checks,
        attestation_id: session.attestation_id,
        created_at: new Date(session.created_at).toISOString(),
        expires_at: session.expires_at ? new Date(session.expires_at).toISOString() : null,
        completed_at: session.completed_at ? new Date(session.completed_at).toISOString() : null,
        // TEST MODE: Include verification code for manual testing (remove in production)
        _test_verification_code: session.verification_code || undefined,
    };
}

// ============================================================================
// Get Session for Counterparty (public info)
// ============================================================================

export async function getSessionForCounterparty(
    env: Env,
    sessionId: string
): Promise<CounterpartyViewSession> {
    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    const initiator = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [session.initiator_user_id]
    );

    const checks = await getProfileChecks(env, session.profile_id);

    return {
        id: session.id,
        title: session.title,
        initiator_email: initiator?.email || 'Unknown',
        initiator_badge_status: session.initiator_badge_status === 1,
        required_chain: session.required_chain,
        required_token: session.required_token,
        required_balance: session.required_balance,
        required_balance_display: session.required_balance_display,
        checks_required: checks,
    };
}

// ============================================================================
// Verify Counterparty Code
// ============================================================================

export async function verifyCounterpartyCode(
    env: Env,
    sessionId: string,
    input: VerifyCounterpartyCodeInput
): Promise<{ verified: boolean }> {
    const now = Date.now();

    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'COUNTERPARTY_INVITED') {
        throw createError('VALIDATION_ERROR', { message: 'Session is not awaiting verification' });
    }

    // Check verification attempts
    if (session.verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw createError('VALIDATION_ERROR', { message: 'Maximum verification attempts exceeded' });
    }

    // Check code expiry
    if (session.verification_code_expires_at && now > session.verification_code_expires_at) {
        throw createError('VALIDATION_ERROR', { message: 'Verification code has expired' });
    }

    // Increment attempts
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions SET verification_attempts = verification_attempts + 1 WHERE id = ?`,
        [sessionId]
    );

    // Verify code
    if (session.verification_code !== input.code) {
        throw createError('VALIDATION_ERROR', { message: 'Invalid verification code' });
    }

    // Update status
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions SET status = 'COUNTERPARTY_VERIFYING' WHERE id = ?`,
        [sessionId]
    );

    await logEvent(env, {
        session_id: sessionId,
        event_type: 'COUNTERPARTY_VERIFIED',
        actor_type: 'COUNTERPARTY',
        actor_identifier: session.counterparty_email,
    });

    return { verified: true };
}

// ============================================================================
// Submit Counterparty Wallet for Verification
// ============================================================================

export async function submitCounterpartyWallet(
    env: Env,
    sessionId: string,
    userId: string | null,
    input: VerifyCounterpartyWalletInput
): Promise<SessionDetail> {
    const now = Date.now();

    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'COUNTERPARTY_VERIFYING') {
        throw createError('VALIDATION_ERROR', { message: 'Session is not awaiting wallet verification' });
    }

    // Update counterparty wallet address
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions
         SET counterparty_wallet_address = ?, counterparty_user_id = ?
         WHERE id = ?`,
        [input.wallet_address, userId, sessionId]
    );

    // Run all checks
    const checks = await getProfileChecks(env, session.profile_id);
    for (const check of checks) {
        await runSessionCheck(env, sessionId, check.id, {
            wallet_address: input.wallet_address,
            signature: input.signature,
            message: input.message,
            chain: session.required_chain,
            required_balance: session.required_balance,
        });
    }

    // Calculate signal summary
    const checkRows = await query<SessionCheckRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_session_checks WHERE session_id = ?`,
        [sessionId]
    );

    const signalSummary = calculateSignalSummary(checkRows as any);

    // Update session with results
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions
         SET status = 'VERIFIED',
             counterparty_verification_status = 'COMPLETED',
             counterparty_signal_summary = ?
         WHERE id = ?`,
        [signalSummary, sessionId]
    );

    await logEvent(env, {
        session_id: sessionId,
        event_type: 'COUNTERPARTY_VERIFIED',
        actor_type: 'COUNTERPARTY',
        actor_identifier: input.wallet_address,
        details: JSON.stringify({ signal_summary: signalSummary }),
    });

    // Return session detail for initiator
    return getSessionDetail(env, sessionId, session.initiator_user_id);
}

// ============================================================================
// Proceed with Session (create attestation)
// ============================================================================

export async function proceedSession(
    env: Env,
    sessionId: string,
    userId: string
): Promise<SessionDetail> {
    const now = Date.now();

    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.initiator_user_id !== userId) {
        throw createError('FORBIDDEN', { message: 'Only the initiator can proceed' });
    }

    if (session.status !== 'VERIFIED') {
        throw createError('VALIDATION_ERROR', { message: 'Session must be verified before proceeding' });
    }

    // TODO: Create attestation
    // For now, just mark as completed
    const attestationId = `gka_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions
         SET status = 'COMPLETED', attestation_id = ?, completed_at = ?
         WHERE id = ?`,
        [attestationId, now, sessionId]
    );

    await logEvent(env, {
        session_id: sessionId,
        event_type: 'SESSION_COMPLETED',
        actor_type: 'INITIATOR',
        actor_identifier: userId,
        details: JSON.stringify({ attestation_id: attestationId }),
    });

    return getSessionDetail(env, sessionId, userId);
}

// ============================================================================
// Abort Session
// ============================================================================

export async function abortSession(
    env: Env,
    sessionId: string,
    userId: string,
    reason?: string
): Promise<void> {
    const now = Date.now();

    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.initiator_user_id !== userId) {
        throw createError('FORBIDDEN', { message: 'Only the initiator can abort' });
    }

    if (['COMPLETED', 'ABORTED', 'EXPIRED'].includes(session.status)) {
        throw createError('VALIDATION_ERROR', { message: 'Session cannot be aborted' });
    }

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions
         SET status = 'ABORTED', aborted_at = ?, abort_reason = ?
         WHERE id = ?`,
        [now, reason || null, sessionId]
    );

    await logEvent(env, {
        session_id: sessionId,
        event_type: 'SESSION_ABORTED',
        actor_type: 'INITIATOR',
        actor_identifier: userId,
        details: reason ? JSON.stringify({ reason }) : undefined,
    });
}

// ============================================================================
// List User's Sessions
// ============================================================================

export async function listUserSessions(
    env: Env,
    userId: string
): Promise<SessionSummary[]> {
    const sessions = await query<SessionRow & { profile_name: string }>(
        env.TATTLEHASH_DB,
        `SELECT gs.*, gp.name as profile_name
         FROM gatekeeper_sessions gs
         JOIN gatekeeper_profiles gp ON gs.profile_id = gp.id
         WHERE gs.initiator_user_id = ?
         ORDER BY gs.created_at DESC`,
        [userId]
    );

    return sessions.map(session => ({
        id: session.id,
        title: session.title,
        status: session.status as any,
        profile_name: session.profile_name,
        counterparty_email: session.counterparty_email,
        initiator_badge_status: session.initiator_badge_status === 1,
        created_at: new Date(session.created_at).toISOString(),
        expires_at: session.expires_at ? new Date(session.expires_at).toISOString() : null,
    }));
}

// ============================================================================
// Resend Verification Code
// ============================================================================

export async function resendVerificationCode(
    env: Env,
    sessionId: string
): Promise<void> {
    const now = Date.now();

    const session = await queryOne<SessionRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_sessions WHERE id = ?`,
        [sessionId]
    );

    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'COUNTERPARTY_INVITED') {
        throw createError('VALIDATION_ERROR', { message: 'Cannot resend code at this stage' });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpiresAt = now + (VERIFICATION_CODE_EXPIRY_HOURS * 60 * 60 * 1000);

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_sessions
         SET verification_code = ?, verification_code_expires_at = ?, verification_attempts = 0
         WHERE id = ?`,
        [verificationCode, verificationCodeExpiresAt, sessionId]
    );

    // Get initiator email
    const initiator = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [session.initiator_user_id]
    );

    // Resend email
    await sendCounterpartyInvitation(
        env,
        sessionId,
        session.counterparty_email,
        initiator?.email || 'TattleHash User',
        session.title,
        verificationCode
    );
}

// ============================================================================
// Send Invitation Email
// ============================================================================

async function sendCounterpartyInvitation(
    env: Env,
    sessionId: string,
    counterpartyEmail: string,
    initiatorEmail: string,
    title: string | null,
    verificationCode: string
): Promise<void> {
    const verifyUrl = `${env.VERIFICATION_PORTAL_URL}/gatekeeper/counterparty-verify.html?id=${sessionId}`;

    const subject = 'Gatekeeper Verification Request from TattleHash';
    const htmlContent = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #00d4ff;">Verification Request</h1>
            <p><strong>${initiatorEmail}</strong> has requested verification for:</p>
            <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h2 style="color: #fff; margin: 0;">${title || 'Gatekeeper Verification'}</h2>
            </div>
            <p>Your verification code is:</p>
            <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-family: monospace; letter-spacing: 8px; color: #00d4ff;">${verificationCode}</span>
            </div>
            <p>Or click below to begin verification:</p>
            <a href="${verifyUrl}" style="display: inline-block; background: #00d4ff; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Begin Verification</a>
            <p style="color: #888; margin-top: 30px; font-size: 12px;">This code expires in 24 hours.</p>
        </div>
    `;

    await sendEmail(env, {
        to: counterpartyEmail,
        subject,
        html: htmlContent,
    });
}
