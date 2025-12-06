/**
 * Enforced Park/Resume Management
 *
 * Simplified park feature:
 * - Each party gets ONE park (2 total max per session)
 * - Fixed 72-hour duration
 * - No consent required (unilateral right)
 * - Only the party who parked can resume early
 */

import { execute, queryOne, query } from '../db';
import { createError } from '../errors';
import type { Env } from '../types';
import type {
    EnforcedParticipantRow,
    RequestParkInput,
    ParkRequestResponse,
} from './types';
import { logEvent } from './events';
import { getSessionById, getSessionWithParticipants, getParticipantByUserId, updateSessionStatus } from './sessions';

// Simplified constants
const PARK_DURATION_HOURS = 72; // Fixed 72-hour duration
const MAX_TOTAL_PARKED_HOURS = 144; // 72 hours x 2 parties max

// ============================================================================
// Request Park
// ============================================================================

export async function requestPark(
    env: Env,
    sessionId: string,
    userId: string,
    input?: RequestParkInput
): Promise<ParkRequestResponse> {
    const now = Date.now();

    // Verify session exists and is in REVIEW status
    const session = await getSessionWithParticipants(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'REVIEW') {
        throw createError('VALIDATION_ERROR', {
            message: 'Can only park sessions in review status'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Check if this participant has already used their ONE park
    const hasParked = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM enforced_events
         WHERE session_id = ? AND participant_id = ? AND event_type = 'PARK_REQUESTED'`,
        [sessionId, participant.id]
    );

    if (hasParked && hasParked.count > 0) {
        throw createError('VALIDATION_ERROR', {
            message: 'You have already used your park for this session'
        });
    }

    // Check total parked hours limit (each party can park once for 72h = 144h max)
    const newTotalParkedHours = session.total_parked_hours + PARK_DURATION_HOURS;
    if (newTotalParkedHours > MAX_TOTAL_PARKED_HOURS) {
        throw createError('VALIDATION_ERROR', {
            message: 'Maximum park time for this session has been reached'
        });
    }

    // Calculate park end time (fixed 72 hours)
    const parkedUntil = now + (PARK_DURATION_HOURS * 60 * 60 * 1000);

    // Calculate new expiry (original expiry + park duration)
    const newExpiresAt = session.expires_at ? session.expires_at + (PARK_DURATION_HOURS * 60 * 60 * 1000) : null;

    // Update session to parked - immediate, no consent required
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_sessions
         SET status = 'PARKED',
             parked_at = ?,
             parked_until = ?,
             parked_by_participant_id = ?,
             park_reason = ?,
             park_count = park_count + 1,
             total_parked_hours = total_parked_hours + ?,
             expires_at = ?
         WHERE id = ?`,
        [
            now,
            parkedUntil,
            participant.id,
            input?.reason || null,
            PARK_DURATION_HOURS,
            newExpiresAt,
            sessionId,
        ]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'PARK_REQUESTED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
        details: JSON.stringify({
            duration_hours: PARK_DURATION_HOURS,
            reason: input?.reason,
            parked_until: new Date(parkedUntil).toISOString(),
        }),
    });

    // TODO: Send notification to other party

    return {
        pending_consent: false, // No consent required
        parked: true,
        parked_until: new Date(parkedUntil).toISOString(),
    };
}

// ============================================================================
// Resume Session (unpark)
// ============================================================================

export async function resumeSession(
    env: Env,
    sessionId: string,
    userId: string
): Promise<void> {
    const now = Date.now();

    // Verify session exists and is parked
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'PARKED') {
        throw createError('VALIDATION_ERROR', {
            message: 'Session is not parked'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Only the party who parked can resume early
    if (session.parked_by_participant_id !== participant.id) {
        throw createError('FORBIDDEN', {
            message: 'Only the party who parked can resume early'
        });
    }

    // Update session back to REVIEW
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_sessions
         SET status = 'REVIEW',
             parked_at = NULL,
             parked_until = NULL,
             parked_by_participant_id = NULL,
             park_reason = NULL
         WHERE id = ?`,
        [sessionId]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'SESSION_RESUMED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
    });

    // TODO: Send notification to other participants
}

// ============================================================================
// Auto-Resume Check (called by scheduled worker)
// ============================================================================

export async function checkAndResumeParkedSessions(env: Env): Promise<number> {
    const now = Date.now();

    // Find parked sessions where parked_until has passed
    const expiredParks = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT id FROM enforced_sessions
         WHERE status = 'PARKED' AND parked_until < ?`,
        [now]
    );

    for (const session of expiredParks) {
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE enforced_sessions
             SET status = 'REVIEW',
                 parked_at = NULL,
                 parked_until = NULL,
                 parked_by_participant_id = NULL,
                 park_reason = NULL
             WHERE id = ?`,
            [session.id]
        );

        await logEvent(env, {
            session_id: session.id,
            event_type: 'SESSION_RESUMED',
            actor_type: 'SYSTEM',
            actor_identifier: 'system',
            details: JSON.stringify({ reason: 'auto_resume' }),
        });

        // TODO: Send notification to all participants
    }

    return expiredParks.length;
}

// ============================================================================
// Park Consent (for future N-party expansion)
// ============================================================================

export async function respondToParkRequest(
    env: Env,
    sessionId: string,
    userId: string,
    accept: boolean
): Promise<void> {
    const now = Date.now();

    // Verify session
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Update consent
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET park_consent_status = ?, park_consent_at = ?
         WHERE id = ?`,
        [accept ? 'ACCEPTED' : 'DECLINED', now, participant.id]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: accept ? 'PARK_ACCEPTED' : 'PARK_DECLINED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
    });

    // In Phase 1, this is not used since parks are auto-approved
    // In future N-party, would check if all consents received
}
