/**
 * Enforced Participant Management
 *
 * Email verification and participant joining flow.
 */

import { execute, queryOne } from '../db';
import { createError } from '../errors';
import type { Env } from '../types';
import type {
    EnforcedParticipantRow,
    VerifyParticipantInput,
    VerificationResponse,
} from './types';
import { logEvent } from './events';
import { getSessionById, updateSessionStatus } from './sessions';

// ============================================================================
// Verify Participant (email code validation)
// ============================================================================

export async function verifyParticipant(
    env: Env,
    sessionId: string,
    input: VerifyParticipantInput
): Promise<VerificationResponse> {
    const now = Date.now();

    // Find participant by verification code
    const participant = await queryOne<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_participants
         WHERE session_id = ? AND verification_code = ?`,
        [sessionId, input.code]
    );

    if (!participant) {
        throw createError('VALIDATION_ERROR', { message: 'Invalid verification code' });
    }

    // Check if already verified
    if (participant.verified_at) {
        return {
            verified: true,
            session_id: sessionId,
            requires_account: !participant.user_id,
        };
    }

    // Check expiry
    if (participant.verification_expires_at && participant.verification_expires_at < now) {
        throw createError('VALIDATION_ERROR', { message: 'Verification code has expired' });
    }

    // Mark as verified
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET verified_at = ?, verification_code = NULL
         WHERE id = ?`,
        [now, participant.id]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'PARTICIPANT_VERIFIED',
        actor_type: 'PARTICIPANT',
        actor_identifier: participant.email,
    });

    // Check if all participants verified → transition to REVIEW
    await checkAndTransitionToReview(env, sessionId);

    return {
        verified: true,
        session_id: sessionId,
        requires_account: true, // They need to create/login to continue
    };
}

// ============================================================================
// Join Session (after verification + account creation/login)
// ============================================================================

export async function joinSession(
    env: Env,
    sessionId: string,
    userId: string
): Promise<void> {
    const now = Date.now();

    // Look up user email
    const user = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [userId]
    );

    if (!user) {
        throw createError('NOT_FOUND', { message: 'User not found' });
    }

    const userEmail = user.email;

    // Find participant by email
    const participant = await queryOne<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_participants
         WHERE session_id = ? AND email = ?`,
        [sessionId, userEmail.toLowerCase()]
    );

    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not invited to this session' });
    }

    // Check if verified
    if (!participant.verified_at) {
        throw createError('VALIDATION_ERROR', { message: 'Please verify your email first' });
    }

    // Check if already joined
    if (participant.user_id) {
        if (participant.user_id !== userId) {
            throw createError('FORBIDDEN', { message: 'Session already joined by another account' });
        }
        return; // Already joined
    }

    // Link user account
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET user_id = ?, joined_at = ?
         WHERE id = ?`,
        [userId, now, participant.id]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'PARTICIPANT_JOINED',
        actor_type: 'PARTICIPANT',
        actor_identifier: userId,
    });

    // Check if all participants verified and joined → transition to REVIEW
    await checkAndTransitionToReview(env, sessionId);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function checkAndTransitionToReview(
    env: Env,
    sessionId: string
): Promise<void> {
    const session = await getSessionById(env, sessionId);
    if (!session || session.status !== 'PENDING') {
        return;
    }

    // Check if all non-initiator participants are verified
    const unverifiedCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM enforced_participants
         WHERE session_id = ? AND role != 'INITIATOR' AND verified_at IS NULL`,
        [sessionId]
    );

    if (unverifiedCount && unverifiedCount.count === 0) {
        await updateSessionStatus(env, sessionId, 'REVIEW');
    }
}

export async function getParticipantById(
    env: Env,
    participantId: string
): Promise<EnforcedParticipantRow | null> {
    return queryOne<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_participants WHERE id = ?',
        [participantId]
    );
}

export async function resendVerificationCode(
    env: Env,
    sessionId: string,
    participantId: string
): Promise<void> {
    const now = Date.now();

    // Generate new code
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const newExpiry = now + (24 * 60 * 60 * 1000); // 24 hours

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET verification_code = ?, verification_expires_at = ?
         WHERE id = ? AND verified_at IS NULL`,
        [newCode, newExpiry, participantId]
    );

    // TODO: Resend invitation email with new code
}
