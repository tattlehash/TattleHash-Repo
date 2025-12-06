/**
 * Gatekeeper User Self-Verification
 *
 * Users must verify themselves before using Gatekeeper.
 * Badge earned based on external signals (not TattleHash tenure).
 */

import { execute, queryOne, query } from '../../db';
import { createError } from '../../errors';
import type { Env } from '../../types';
import type {
    UserVerificationRow,
    UserVerificationCheckRow,
    UserVerification,
    CheckResult,
    StartVerificationInput,
    SubmitWalletSignatureInput,
    SignalSummary,
    VerificationStatus,
} from './types';
import { getProfile, getProfileChecks } from './profiles';
import { logEvent } from './events';
import { runCheck, calculateSignalSummary, calculateBadgeStatus } from './checks';

// ============================================================================
// Constants
// ============================================================================

const VERIFICATION_EXPIRY_MONTHS = 12;

// ============================================================================
// Get User's Current Verification Status
// ============================================================================

export async function getUserVerification(
    env: Env,
    userId: string
): Promise<UserVerification | null> {
    // Get the most recent non-expired verification
    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications
         WHERE user_id = ? AND status = 'COMPLETED'
         AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
        [userId, Date.now()]
    );

    if (!verification) {
        return null;
    }

    return formatUserVerification(env, verification);
}

// ============================================================================
// Get User's Active Verification (including in-progress)
// ============================================================================

export async function getActiveUserVerification(
    env: Env,
    userId: string
): Promise<UserVerification | null> {
    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications
         WHERE user_id = ?
         AND (status != 'COMPLETED' OR (status = 'COMPLETED' AND (expires_at IS NULL OR expires_at > ?)))
         ORDER BY created_at DESC LIMIT 1`,
        [userId, Date.now()]
    );

    if (!verification) {
        return null;
    }

    return formatUserVerification(env, verification);
}

// ============================================================================
// Start Verification
// ============================================================================

export async function startVerification(
    env: Env,
    userId: string,
    input: StartVerificationInput
): Promise<UserVerification> {
    const now = Date.now();

    // Verify profile exists
    const profile = await getProfile(env, input.profile_id);
    if (!profile) {
        throw createError('NOT_FOUND', { message: 'Profile not found' });
    }

    // Check if user has an existing pending verification
    const existing = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications
         WHERE user_id = ? AND status IN ('PENDING', 'IN_PROGRESS')
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );

    if (existing) {
        // Return existing verification
        return formatUserVerification(env, existing);
    }

    // Create new verification
    const verificationId = `gkuv_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const expiresAt = now + (VERIFICATION_EXPIRY_MONTHS * 30 * 24 * 60 * 60 * 1000);

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO gatekeeper_user_verifications
         (id, user_id, profile_id, status, wallet_address, wallet_chain, created_at, expires_at)
         VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        [
            verificationId,
            userId,
            input.profile_id,
            input.wallet_address || null,
            input.wallet_chain || null,
            now,
            expiresAt,
        ]
    );

    // Create check records for each profile check
    const checks = await getProfileChecks(env, input.profile_id);
    for (const check of checks) {
        const checkId = `gkuc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO gatekeeper_user_verification_checks
             (id, user_verification_id, check_type_id, status, created_at)
             VALUES (?, ?, ?, 'PENDING', ?)`,
            [checkId, verificationId, check.id, now]
        );
    }

    // Log event
    await logEvent(env, {
        user_verification_id: verificationId,
        event_type: 'USER_VERIFICATION_STARTED',
        actor_type: 'USER',
        actor_identifier: userId,
        details: JSON.stringify({ profile_id: input.profile_id }),
    });

    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications WHERE id = ?`,
        [verificationId]
    );

    return formatUserVerification(env, verification!);
}

// ============================================================================
// Submit Wallet Signature for Verification
// ============================================================================

export async function submitWalletSignature(
    env: Env,
    userId: string,
    input: SubmitWalletSignatureInput
): Promise<UserVerification> {
    const now = Date.now();

    // Get user's active verification
    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications
         WHERE user_id = ? AND status IN ('PENDING', 'IN_PROGRESS')
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );

    if (!verification) {
        throw createError('NOT_FOUND', { message: 'No active verification found' });
    }

    // Update verification with wallet address
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_user_verifications
         SET wallet_address = ?, wallet_chain = ?, status = 'IN_PROGRESS'
         WHERE id = ?`,
        [input.wallet_address, input.chain || 'ethereum', verification.id]
    );

    // Run the wallet ownership check
    await runCheck(env, verification.id, 'wallet_ownership', {
        wallet_address: input.wallet_address,
        signature: input.signature,
        message: input.message,
        chain: input.chain || 'ethereum',
    });

    // Run remaining checks that don't require user input
    await runRemainingChecks(env, verification.id, input.wallet_address, input.chain || 'ethereum');

    // Check if all checks are complete
    await checkVerificationComplete(env, verification.id);

    // Get updated verification
    const updated = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications WHERE id = ?`,
        [verification.id]
    );

    return formatUserVerification(env, updated!);
}

// ============================================================================
// Run Remaining Checks (after wallet verification)
// ============================================================================

async function runRemainingChecks(
    env: Env,
    verificationId: string,
    walletAddress: string,
    chain: string
): Promise<void> {
    // Get pending checks
    const pendingChecks = await query<UserVerificationCheckRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verification_checks
         WHERE user_verification_id = ? AND status = 'PENDING'`,
        [verificationId]
    );

    for (const check of pendingChecks) {
        if (check.check_type_id === 'wallet_ownership') {
            continue; // Already handled
        }

        await runCheck(env, verificationId, check.check_type_id, {
            wallet_address: walletAddress,
            chain,
        });
    }
}

// ============================================================================
// Check if Verification is Complete
// ============================================================================

async function checkVerificationComplete(env: Env, verificationId: string): Promise<void> {
    const now = Date.now();

    // Get all checks for this verification
    const checks = await query<UserVerificationCheckRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verification_checks WHERE user_verification_id = ?`,
        [verificationId]
    );

    // Check if all checks are completed
    const allComplete = checks.every(check =>
        check.status === 'COMPLETED' || check.status === 'FAILED'
    );

    if (!allComplete) {
        return;
    }

    // Calculate signal summary
    const signalSummary = calculateSignalSummary(checks);

    // Calculate badge status
    const { badgeGranted, badgeReason } = calculateBadgeStatus(checks);

    // Get verification
    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications WHERE id = ?`,
        [verificationId]
    );

    // Update verification as complete
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE gatekeeper_user_verifications
         SET status = 'COMPLETED', signal_summary = ?, badge_granted = ?,
             badge_reason = ?, verified_at = ?
         WHERE id = ?`,
        [signalSummary, badgeGranted ? 1 : 0, badgeReason, now, verificationId]
    );

    // Log event
    await logEvent(env, {
        user_verification_id: verificationId,
        event_type: 'USER_VERIFICATION_COMPLETED',
        actor_type: 'SYSTEM',
        actor_identifier: 'system',
        details: JSON.stringify({
            signal_summary: signalSummary,
            badge_granted: badgeGranted,
            badge_reason: badgeReason,
        }),
    });
}

// ============================================================================
// Format User Verification for API Response
// ============================================================================

async function formatUserVerification(
    env: Env,
    verification: UserVerificationRow
): Promise<UserVerification> {
    const profile = await getProfile(env, verification.profile_id);

    // Get check results
    const checkRows = await query<UserVerificationCheckRow & { name: string }>(
        env.TATTLEHASH_DB,
        `SELECT uvc.*, ct.name
         FROM gatekeeper_user_verification_checks uvc
         JOIN gatekeeper_check_types ct ON uvc.check_type_id = ct.id
         WHERE uvc.user_verification_id = ?
         ORDER BY ct.sort_order`,
        [verification.id]
    );

    const checks: CheckResult[] = checkRows.map(row => ({
        check_type_id: row.check_type_id,
        check_name: row.name,
        status: row.status as any,
        signal_type: row.signal_type as any,
        signal_text: row.signal_text,
        meets_badge_threshold: row.meets_badge_threshold === 1,
    }));

    return {
        id: verification.id,
        profile_id: verification.profile_id,
        profile_name: profile?.name || 'Unknown',
        status: verification.status as VerificationStatus,
        signal_summary: verification.signal_summary as SignalSummary | null,
        badge_granted: verification.badge_granted === 1,
        badge_reason: verification.badge_reason,
        wallet_address: verification.wallet_address,
        checks,
        created_at: new Date(verification.created_at).toISOString(),
        verified_at: verification.verified_at
            ? new Date(verification.verified_at).toISOString()
            : null,
        expires_at: verification.expires_at
            ? new Date(verification.expires_at).toISOString()
            : null,
    };
}

// ============================================================================
// Check if User Has Valid Verification (for session creation)
// ============================================================================

export async function hasValidVerification(
    env: Env,
    userId: string
): Promise<{ valid: boolean; verification: UserVerificationRow | null }> {
    const verification = await queryOne<UserVerificationRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_user_verifications
         WHERE user_id = ? AND status = 'COMPLETED'
         AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
        [userId, Date.now()]
    );

    return {
        valid: verification !== null,
        verification,
    };
}
