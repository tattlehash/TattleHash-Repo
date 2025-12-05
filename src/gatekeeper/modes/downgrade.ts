/**
 * Auto-Downgrade Module
 *
 * Handles automatic downgrade of GATEKEEPER/ENFORCED challenges to FIRE mode
 * when the counterparty fails to respond within the timeout period.
 *
 * Timeout Configuration:
 * - Default: 72 hours (configurable via DOWNGRADE_TIMEOUT_HOURS env var)
 * - Per-challenge: Set via expires_at field (specific date/time like an alarm clock)
 *
 * Patent Reference: TraceAI v3.1 - Auto-downgrade feature for incomplete challenges
 */

import { execute, query, queryOne } from '../../db';
import { Env } from '../../types';
import type { Challenge, ChallengeMode } from '../challenges/types';
import { getChallengeById } from '../challenges/create';
import { emitEvent } from '../../relay';

// ============================================================================
// Constants & Configuration
// ============================================================================

/** Default timeout for counterparty response: 72 hours in milliseconds */
export const DEFAULT_COUNTERPARTY_TIMEOUT_MS = 72 * 60 * 60 * 1000;

/** Minimum allowed timeout: 1 hour */
export const MIN_TIMEOUT_MS = 60 * 60 * 1000;

/** Maximum allowed timeout: 30 days */
export const MAX_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum challenges to process per sweep to avoid timeout */
const MAX_DOWNGRADES_PER_SWEEP = 25;

/**
 * Get the configured timeout from environment or use default.
 * Can be set via DOWNGRADE_TIMEOUT_HOURS environment variable.
 */
export function getConfiguredTimeout(env: Env): number {
    const envTimeout = (env as any).DOWNGRADE_TIMEOUT_HOURS;
    if (envTimeout) {
        const hours = parseFloat(envTimeout);
        if (!isNaN(hours) && hours > 0) {
            const ms = hours * 60 * 60 * 1000;
            // Clamp to min/max bounds
            return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, ms));
        }
    }
    return DEFAULT_COUNTERPARTY_TIMEOUT_MS;
}

// Legacy export for backwards compatibility
export const COUNTERPARTY_TIMEOUT_MS = DEFAULT_COUNTERPARTY_TIMEOUT_MS;

// ============================================================================
// Types
// ============================================================================

export interface DowngradeResult {
    challenge_id: string;
    original_mode: ChallengeMode;
    downgraded_to: 'FIRE';
    downgraded_at: number;
    reason: string;
    creator_notified: boolean;
}

export interface DowngradeSweepResult {
    processed: number;
    downgraded: number;
    failed: number;
    duration_ms: number;
    results: Array<{
        challenge_id: string;
        ok: boolean;
        reason?: string;
    }>;
}

// ============================================================================
// Core Downgrade Logic
// ============================================================================

/**
 * Find challenges that are eligible for auto-downgrade:
 * - Mode is GATEKEEPER or ENFORCED
 * - Status is AWAITING_COUNTERPARTY
 * - Either:
 *   1. Has explicit expires_at set and that time has passed (alarm clock mode)
 *   2. No expires_at set and created more than timeout period ago (default behavior)
 *
 * The expires_at field takes precedence - if set, it acts like an alarm clock
 * for exactly when the challenge should expire/downgrade.
 */
export async function findExpiredPendingChallenges(
    env: Env,
    limit: number = MAX_DOWNGRADES_PER_SWEEP
): Promise<Challenge[]> {
    const timeout = getConfiguredTimeout(env);
    const cutoffTime = Date.now() - timeout;
    const nowIso = new Date().toISOString();

    // Find challenges that have been waiting for counterparty too long
    // Priority: expires_at (alarm clock) > default timeout from created_at
    const challenges = await query<Challenge>(
        env.TATTLEHASH_DB,
        `SELECT * FROM challenges
         WHERE mode IN ('GATEKEEPER', 'ENFORCED')
         AND status = 'AWAITING_COUNTERPARTY'
         AND (
             -- Alarm clock mode: explicit expires_at has passed
             (expires_at IS NOT NULL AND expires_at < ?)
             -- Default mode: no expires_at set and created before cutoff
             OR (expires_at IS NULL AND created_at < ?)
         )
         ORDER BY
             -- Process explicit deadlines first
             CASE WHEN expires_at IS NOT NULL THEN 0 ELSE 1 END,
             -- Then by age
             created_at ASC
         LIMIT ?`,
        [nowIso, cutoffTime, limit]
    );

    return challenges;
}

/**
 * Check if a specific challenge is expired and eligible for downgrade.
 * Useful for checking a single challenge without running full sweep.
 */
export async function isChallengeExpired(env: Env, challengeId: string): Promise<{
    expired: boolean;
    reason?: string;
    expiresAt?: string;
    timeRemaining?: number;
}> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        return { expired: false, reason: 'Challenge not found' };
    }

    if (!['GATEKEEPER', 'ENFORCED'].includes(challenge.mode)) {
        return { expired: false, reason: 'Not a GATEKEEPER/ENFORCED challenge' };
    }

    if (challenge.status !== 'AWAITING_COUNTERPARTY') {
        return { expired: false, reason: `Status is ${challenge.status}, not AWAITING_COUNTERPARTY` };
    }

    const now = Date.now();

    // Check explicit expires_at (alarm clock mode)
    if (challenge.expires_at) {
        const expiresAtMs = new Date(challenge.expires_at).getTime();
        if (now >= expiresAtMs) {
            return {
                expired: true,
                reason: 'Explicit expiry time reached',
                expiresAt: challenge.expires_at,
            };
        }
        return {
            expired: false,
            expiresAt: challenge.expires_at,
            timeRemaining: expiresAtMs - now,
        };
    }

    // Check default timeout
    const timeout = getConfiguredTimeout(env);
    const expiresAtMs = challenge.created_at + timeout;

    if (now >= expiresAtMs) {
        return {
            expired: true,
            reason: 'Default timeout reached',
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
    }

    return {
        expired: false,
        expiresAt: new Date(expiresAtMs).toISOString(),
        timeRemaining: expiresAtMs - now,
    };
}

/**
 * Downgrade a GATEKEEPER/ENFORCED challenge to FIRE mode when counterparty times out.
 *
 * This function:
 * 1. Changes the mode from GATEKEEPER/ENFORCED to FIRE
 * 2. Updates status to COMPLETED
 * 3. Records the downgrade reason and timestamp
 * 4. Logs an audit event
 * 5. Emits a notification event for the creator
 */
export async function handleCounterpartyTimeout(
    env: Env,
    challengeId: string
): Promise<DowngradeResult> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw new Error(`Challenge not found: ${challengeId}`);
    }

    // Validate challenge is eligible for downgrade
    if (!['GATEKEEPER', 'ENFORCED'].includes(challenge.mode)) {
        throw new Error(`Cannot downgrade ${challenge.mode} mode challenge`);
    }

    if (challenge.status !== 'AWAITING_COUNTERPARTY') {
        throw new Error(`Challenge status is ${challenge.status}, expected AWAITING_COUNTERPARTY`);
    }

    const now = Date.now();
    const originalMode = challenge.mode;
    const reason = `Counterparty did not respond within 72 hours. Auto-downgraded from ${originalMode} to FIRE mode.`;

    // Update challenge: change mode to FIRE and status to COMPLETED
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET
            mode = 'FIRE',
            status = 'COMPLETED',
            resolved_at = ?,
            updated_at = ?,
            -- Store downgrade metadata in description (append to existing)
            description = CASE
                WHEN description IS NULL OR description = '' THEN ?
                ELSE description || ' [AUTO-DOWNGRADE: ' || ? || ']'
            END
         WHERE id = ?`,
        [now, now, reason, reason, challengeId]
    );

    // Log the downgrade event in audit trail
    await logDowngradeEvent(env, {
        challenge_id: challengeId,
        original_mode: originalMode,
        downgraded_to: 'FIRE',
        reason,
        downgraded_at: now,
        creator_user_id: challenge.creator_user_id,
        counterparty_user_id: challenge.counterparty_user_id,
    });

    // Emit notification event for the creator
    let creatorNotified = false;
    try {
        await emitEvent(env, {
            type: 'challenge.downgraded',
            challenge_id: challengeId,
            data: {
                original_mode: originalMode,
                new_mode: 'FIRE',
                reason,
                downgraded_at: new Date(now).toISOString(),
            },
        });
        creatorNotified = true;
    } catch (error) {
        console.error(`Failed to emit downgrade notification for ${challengeId}:`, error);
    }

    // Log structured output
    console.log(JSON.stringify({
        t: now,
        at: 'challenge_auto_downgraded',
        challenge_id: challengeId,
        original_mode: originalMode,
        new_mode: 'FIRE',
        creator_user_id: challenge.creator_user_id,
        counterparty_user_id: challenge.counterparty_user_id,
        created_at: challenge.created_at,
        hours_waiting: Math.round((now - challenge.created_at) / (60 * 60 * 1000)),
    }));

    return {
        challenge_id: challengeId,
        original_mode: originalMode as ChallengeMode,
        downgraded_to: 'FIRE',
        downgraded_at: now,
        reason,
        creator_notified: creatorNotified,
    };
}

// ============================================================================
// Sweep Processing
// ============================================================================

/**
 * Process all challenges eligible for auto-downgrade.
 * This is called from the cron job handler.
 */
export async function processDowngrades(env: Env): Promise<DowngradeSweepResult> {
    const startTime = Date.now();
    const results: Array<{ challenge_id: string; ok: boolean; reason?: string }> = [];

    try {
        const expiredChallenges = await findExpiredPendingChallenges(env);

        for (const challenge of expiredChallenges) {
            try {
                await handleCounterpartyTimeout(env, challenge.id);
                results.push({ challenge_id: challenge.id, ok: true });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({
                    challenge_id: challenge.id,
                    ok: false,
                    reason: errorMessage,
                });
                console.error(`Failed to downgrade challenge ${challenge.id}:`, errorMessage);
            }
        }

        const downgraded = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok).length;
        const duration = Date.now() - startTime;

        // Log sweep summary
        if (results.length > 0) {
            console.log(JSON.stringify({
                t: Date.now(),
                at: 'downgrade_sweep_complete',
                processed: results.length,
                downgraded,
                failed,
                duration_ms: duration,
            }));
        }

        return {
            processed: results.length,
            downgraded,
            failed,
            duration_ms: duration,
            results,
        };
    } catch (error) {
        console.error('[downgrade_sweep] fatal error:', error);
        return {
            processed: results.length,
            downgraded: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            duration_ms: Date.now() - startTime,
            results,
        };
    }
}

// ============================================================================
// Audit Logging
// ============================================================================

interface DowngradeEventInput {
    challenge_id: string;
    original_mode: ChallengeMode;
    downgraded_to: 'FIRE';
    reason: string;
    downgraded_at: number;
    creator_user_id: string;
    counterparty_user_id?: string;
}

/**
 * Log downgrade event to the challenge_events table for audit trail
 */
async function logDowngradeEvent(env: Env, input: DowngradeEventInput): Promise<void> {
    const eventId = crypto.randomUUID();

    // Try to insert into challenge_events if the table exists
    try {
        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO challenge_events (
                id, challenge_id, event_type, actor_type, actor_id,
                details, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                eventId,
                input.challenge_id,
                'AUTO_DOWNGRADE',
                'SYSTEM',
                'cron:downgrade_sweep',
                JSON.stringify({
                    original_mode: input.original_mode,
                    new_mode: input.downgraded_to,
                    reason: input.reason,
                    creator_user_id: input.creator_user_id,
                    counterparty_user_id: input.counterparty_user_id,
                }),
                input.downgraded_at,
            ]
        );
    } catch (error) {
        // Table might not exist, log to KV as fallback
        console.warn('Could not log to challenge_events table, using KV fallback');
        await env.TATTLEHASH_KV.put(
            `downgrade_event:${input.challenge_id}:${eventId}`,
            JSON.stringify({
                ...input,
                event_id: eventId,
            }),
            { expirationTtl: 365 * 24 * 60 * 60 } // 1 year
        );
    }
}

// ============================================================================
// Manual Trigger (for admin use)
// ============================================================================

/**
 * Manually trigger downgrade for a specific challenge (admin function)
 */
export async function manualDowngrade(
    env: Env,
    challengeId: string,
    adminUserId: string
): Promise<DowngradeResult> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw new Error(`Challenge not found: ${challengeId}`);
    }

    // For manual downgrade, allow from more states
    if (!['GATEKEEPER', 'ENFORCED'].includes(challenge.mode)) {
        throw new Error(`Cannot downgrade ${challenge.mode} mode challenge`);
    }

    if (!['AWAITING_COUNTERPARTY', 'DRAFT'].includes(challenge.status)) {
        throw new Error(`Challenge status ${challenge.status} not eligible for manual downgrade`);
    }

    const now = Date.now();
    const originalMode = challenge.mode;
    const reason = `Manually downgraded by admin ${adminUserId} from ${originalMode} to FIRE mode.`;

    // Update challenge
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET
            mode = 'FIRE',
            status = 'COMPLETED',
            resolved_at = ?,
            updated_at = ?,
            description = CASE
                WHEN description IS NULL OR description = '' THEN ?
                ELSE description || ' [MANUAL-DOWNGRADE: ' || ? || ']'
            END
         WHERE id = ?`,
        [now, now, reason, reason, challengeId]
    );

    // Log event with admin info
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO challenge_events (
            id, challenge_id, event_type, actor_type, actor_id,
            details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            crypto.randomUUID(),
            challengeId,
            'MANUAL_DOWNGRADE',
            'ADMIN',
            adminUserId,
            JSON.stringify({
                original_mode: originalMode,
                new_mode: 'FIRE',
                reason,
            }),
            now,
        ]
    ).catch(() => {
        // Ignore if table doesn't exist
    });

    console.log(JSON.stringify({
        t: now,
        at: 'challenge_manual_downgrade',
        challenge_id: challengeId,
        original_mode: originalMode,
        admin_user_id: adminUserId,
    }));

    return {
        challenge_id: challengeId,
        original_mode: originalMode as ChallengeMode,
        downgraded_to: 'FIRE',
        downgraded_at: now,
        reason,
        creator_notified: false, // Manual downgrades don't auto-notify
    };
}

// ============================================================================
// Expiry Configuration (Alarm Clock Mode)
// ============================================================================

export interface SetExpiryInput {
    /** ISO 8601 date string for specific date/time expiry */
    expiresAt?: string;
    /** Hours from now until expiry (alternative to expiresAt) */
    expiresInHours?: number;
    /** Minutes from now until expiry (for short timeframes) */
    expiresInMinutes?: number;
}

export interface ExpiryResult {
    challenge_id: string;
    expires_at: string;
    time_remaining_ms: number;
    updated_by?: string;
}

/**
 * Set or update the expiry time for a challenge (alarm clock style).
 * This allows users to specify exactly when a challenge should expire/downgrade.
 *
 * @param env - Environment bindings
 * @param challengeId - The challenge to update
 * @param input - Expiry configuration (date/time or duration)
 * @param userId - User making the change (for audit)
 * @returns Updated expiry information
 *
 * @example
 * // Set expiry to specific date/time
 * await setChallengeExpiry(env, challengeId, {
 *   expiresAt: '2025-12-10T15:30:00Z'
 * }, userId);
 *
 * @example
 * // Set expiry to 48 hours from now
 * await setChallengeExpiry(env, challengeId, {
 *   expiresInHours: 48
 * }, userId);
 *
 * @example
 * // Set expiry to 30 minutes from now (for urgent situations)
 * await setChallengeExpiry(env, challengeId, {
 *   expiresInMinutes: 30
 * }, userId);
 */
export async function setChallengeExpiry(
    env: Env,
    challengeId: string,
    input: SetExpiryInput,
    userId?: string
): Promise<ExpiryResult> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw new Error(`Challenge not found: ${challengeId}`);
    }

    // Only allow setting expiry on GATEKEEPER/ENFORCED challenges
    if (!['GATEKEEPER', 'ENFORCED'].includes(challenge.mode)) {
        throw new Error(`Cannot set expiry on ${challenge.mode} mode challenges`);
    }

    // Only allow setting expiry on challenges still awaiting response
    if (!['DRAFT', 'AWAITING_COUNTERPARTY'].includes(challenge.status)) {
        throw new Error(`Cannot modify expiry on challenge with status ${challenge.status}`);
    }

    // Calculate expires_at from input
    let expiresAt: Date;
    const now = Date.now();

    if (input.expiresAt) {
        // Specific date/time provided
        expiresAt = new Date(input.expiresAt);
        if (isNaN(expiresAt.getTime())) {
            throw new Error('Invalid date format for expiresAt');
        }
    } else if (input.expiresInHours !== undefined) {
        // Duration in hours
        const ms = input.expiresInHours * 60 * 60 * 1000;
        if (ms < MIN_TIMEOUT_MS) {
            throw new Error(`Minimum expiry is ${MIN_TIMEOUT_MS / (60 * 60 * 1000)} hour(s)`);
        }
        if (ms > MAX_TIMEOUT_MS) {
            throw new Error(`Maximum expiry is ${MAX_TIMEOUT_MS / (24 * 60 * 60 * 1000)} days`);
        }
        expiresAt = new Date(now + ms);
    } else if (input.expiresInMinutes !== undefined) {
        // Duration in minutes (for short timeframes)
        const ms = input.expiresInMinutes * 60 * 1000;
        if (ms < 5 * 60 * 1000) {
            throw new Error('Minimum expiry is 5 minutes');
        }
        if (ms > MAX_TIMEOUT_MS) {
            throw new Error(`Maximum expiry is ${MAX_TIMEOUT_MS / (24 * 60 * 60 * 1000)} days`);
        }
        expiresAt = new Date(now + ms);
    } else {
        throw new Error('Must provide expiresAt, expiresInHours, or expiresInMinutes');
    }

    // Ensure expiry is in the future
    if (expiresAt.getTime() <= now) {
        throw new Error('Expiry time must be in the future');
    }

    const expiresAtIso = expiresAt.toISOString();

    // Update the challenge
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET expires_at = ?, updated_at = ? WHERE id = ?`,
        [expiresAtIso, now, challengeId]
    );

    // Log the change
    console.log(JSON.stringify({
        t: now,
        at: 'challenge_expiry_set',
        challenge_id: challengeId,
        expires_at: expiresAtIso,
        updated_by: userId,
        previous_expires_at: challenge.expires_at,
    }));

    return {
        challenge_id: challengeId,
        expires_at: expiresAtIso,
        time_remaining_ms: expiresAt.getTime() - now,
        updated_by: userId,
    };
}

/**
 * Clear the explicit expiry time from a challenge, reverting to default timeout.
 */
export async function clearChallengeExpiry(
    env: Env,
    challengeId: string,
    userId?: string
): Promise<{ challenge_id: string; default_timeout_hours: number }> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw new Error(`Challenge not found: ${challengeId}`);
    }

    const now = Date.now();

    // Clear expires_at
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET expires_at = NULL, updated_at = ? WHERE id = ?`,
        [now, challengeId]
    );

    const defaultTimeout = getConfiguredTimeout(env);

    console.log(JSON.stringify({
        t: now,
        at: 'challenge_expiry_cleared',
        challenge_id: challengeId,
        cleared_by: userId,
        previous_expires_at: challenge.expires_at,
        default_timeout_hours: defaultTimeout / (60 * 60 * 1000),
    }));

    return {
        challenge_id: challengeId,
        default_timeout_hours: defaultTimeout / (60 * 60 * 1000),
    };
}

/**
 * Extend the expiry time by a specified duration.
 * Useful for granting more time without calculating new absolute time.
 */
export async function extendChallengeExpiry(
    env: Env,
    challengeId: string,
    extensionHours: number,
    userId?: string
): Promise<ExpiryResult> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw new Error(`Challenge not found: ${challengeId}`);
    }

    if (!['GATEKEEPER', 'ENFORCED'].includes(challenge.mode)) {
        throw new Error(`Cannot extend expiry on ${challenge.mode} mode challenges`);
    }

    if (!['DRAFT', 'AWAITING_COUNTERPARTY'].includes(challenge.status)) {
        throw new Error(`Cannot modify expiry on challenge with status ${challenge.status}`);
    }

    const now = Date.now();
    const extensionMs = extensionHours * 60 * 60 * 1000;

    // Calculate new expiry: extend from current expiry or from now if none set
    let currentExpiry: number;
    if (challenge.expires_at) {
        currentExpiry = new Date(challenge.expires_at).getTime();
    } else {
        // No expiry set, calculate from default timeout
        const defaultTimeout = getConfiguredTimeout(env);
        currentExpiry = challenge.created_at + defaultTimeout;
    }

    const newExpiry = new Date(Math.max(currentExpiry, now) + extensionMs);

    // Validate max
    if (newExpiry.getTime() - now > MAX_TIMEOUT_MS) {
        throw new Error(`Extension would exceed maximum timeout of ${MAX_TIMEOUT_MS / (24 * 60 * 60 * 1000)} days`);
    }

    const newExpiryIso = newExpiry.toISOString();

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET expires_at = ?, updated_at = ? WHERE id = ?`,
        [newExpiryIso, now, challengeId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'challenge_expiry_extended',
        challenge_id: challengeId,
        extension_hours: extensionHours,
        new_expires_at: newExpiryIso,
        extended_by: userId,
        previous_expires_at: challenge.expires_at,
    }));

    return {
        challenge_id: challengeId,
        expires_at: newExpiryIso,
        time_remaining_ms: newExpiry.getTime() - now,
        updated_by: userId,
    };
}
