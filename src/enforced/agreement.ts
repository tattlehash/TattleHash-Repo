/**
 * Enforced Agreement Management
 *
 * Handle agree/decline flow for all participants.
 * When all parties agree, triggers completion flow.
 */

import { execute, queryOne, query } from '../db';
import { createError } from '../errors';
import type { Env } from '../types';
import type { EnforcedParticipantRow, DeclineInput } from './types';
import { logEvent } from './events';
import { getSessionById, getSessionWithParticipants, getParticipantByUserId, updateSessionStatus } from './sessions';
import { completeSession } from './completion';

// ============================================================================
// Submit Agreement
// ============================================================================

export async function submitAgreement(
    env: Env,
    sessionId: string,
    userId: string
): Promise<{ all_agreed: boolean; completion_started: boolean }> {
    const now = Date.now();

    // Verify session exists and is in REVIEW status
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (session.status !== 'REVIEW') {
        throw createError('VALIDATION_ERROR', {
            message: 'Can only agree when session is in review status'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Check if already agreed
    if (participant.agreement_status === 'AGREED') {
        // Return current status
        return await checkAllAgreed(env, sessionId);
    }

    // Check if participant has uploaded at least one document
    const docCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM enforced_documents
         WHERE session_id = ? AND participant_id = ? AND deleted_at IS NULL`,
        [sessionId, participant.id]
    );

    // Note: We don't require documents from both parties, just allow agreement
    // The initiator may have uploaded all relevant documents

    // Mark as agreed
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET agreement_status = 'AGREED', agreed_at = ?
         WHERE id = ?`,
        [now, participant.id]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'AGREEMENT_SUBMITTED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
    });

    // Check if all parties have agreed
    return await checkAllAgreed(env, sessionId);
}

// ============================================================================
// Submit Decline
// ============================================================================

export async function submitDecline(
    env: Env,
    sessionId: string,
    userId: string,
    input?: DeclineInput
): Promise<void> {
    const now = Date.now();

    // Verify session exists and is in PENDING or REVIEW status
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (!['PENDING', 'REVIEW'].includes(session.status)) {
        throw createError('VALIDATION_ERROR', {
            message: 'Cannot decline session in current status'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Mark as declined
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET agreement_status = 'DECLINED', declined_at = ?, decline_reason = ?
         WHERE id = ?`,
        [now, input?.reason || null, participant.id]
    );

    // Void the session
    await updateSessionStatus(env, sessionId, 'VOID');

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'DECLINE_SUBMITTED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
        details: input?.reason ? JSON.stringify({ reason: input.reason }) : undefined,
    });

    await logEvent(env, {
        session_id: sessionId,
        event_type: 'SESSION_VOIDED',
        actor_type: 'SYSTEM',
        actor_identifier: 'system',
        details: JSON.stringify({ reason: 'participant_declined' }),
    });

    // TODO: Send notification emails to all participants
    // TODO: Trigger cleanup
}

// ============================================================================
// Reset Agreement (when new document uploaded)
// ============================================================================

export async function resetOtherPartyAgreement(
    env: Env,
    sessionId: string,
    uploadingParticipantId: string
): Promise<void> {
    const now = Date.now();

    // Get all other participants who have agreed
    const agreedParticipants = await query<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_participants
         WHERE session_id = ? AND id != ? AND agreement_status = 'AGREED'`,
        [sessionId, uploadingParticipantId]
    );

    if (agreedParticipants.length === 0) {
        return;
    }

    // Reset their agreement status
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_participants
         SET agreement_status = 'PENDING', agreed_at = NULL
         WHERE session_id = ? AND id != ? AND agreement_status = 'AGREED'`,
        [sessionId, uploadingParticipantId]
    );

    // Log events
    for (const p of agreedParticipants) {
        await logEvent(env, {
            session_id: sessionId,
            participant_id: p.id,
            event_type: 'AGREEMENT_RESET',
            actor_type: 'SYSTEM',
            actor_identifier: 'system',
            details: JSON.stringify({
                reason: 'new_document_uploaded',
                triggered_by: uploadingParticipantId,
            }),
        });
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function checkAllAgreed(
    env: Env,
    sessionId: string
): Promise<{ all_agreed: boolean; completion_started: boolean }> {
    const session = await getSessionWithParticipants(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    // Check if all non-observer participants have agreed
    const activeParticipants = session.participants.filter(p => p.role !== 'OBSERVER');
    const allAgreed = activeParticipants.every(p => p.agreement_status === 'AGREED');

    if (allAgreed) {
        // Trigger completion flow
        try {
            await completeSession(env, sessionId);
            return { all_agreed: true, completion_started: true };
        } catch (error) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'enforced_completion_failed',
                session_id: sessionId,
                error: String(error),
            }));
            throw error;
        }
    }

    return { all_agreed: false, completion_started: false };
}

// ============================================================================
// Get Agreement Status
// ============================================================================

export async function getAgreementStatus(
    env: Env,
    sessionId: string
): Promise<Array<{ participant_id: string; email: string; status: string; agreed_at: number | null }>> {
    return query(
        env.TATTLEHASH_DB,
        `SELECT id as participant_id, email, agreement_status as status, agreed_at
         FROM enforced_participants
         WHERE session_id = ? AND role != 'OBSERVER'
         ORDER BY created_at ASC`,
        [sessionId]
    );
}
