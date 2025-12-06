/**
 * Enforced Session Management
 *
 * Create, retrieve, and manage enforced document review sessions.
 */

import { execute, queryOne, query } from '../db';
import { createError } from '../errors';
import { sendEmail } from '../email';
import type { Env } from '../types';
import type {
    EnforcedSessionRow,
    EnforcedParticipantRow,
    CreateSessionInput,
    SessionResponse,
    SessionStatusResponse,
    SessionWithParticipants,
    ENFORCED_LIMITS,
} from './types';
import { logEvent } from './events';

// ============================================================================
// Create Session
// ============================================================================

export async function createSession(
    env: Env,
    initiatorUserId: string,
    input: CreateSessionInput
): Promise<SessionResponse> {
    const sessionId = `enf_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Date.now();
    const reviewHours = input.review_period_hours || 72;
    const expiresAt = now + (reviewHours * 60 * 60 * 1000);

    // Look up initiator's email
    const initiator = await queryOne<{ email: string }>(
        env.TATTLEHASH_DB,
        'SELECT email FROM users WHERE id = ?',
        [initiatorUserId]
    );

    if (!initiator) {
        throw createError('NOT_FOUND', { message: 'User not found' });
    }

    const initiatorEmail = initiator.email;

    // Generate verification code for counterparty (6 digits)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = now + (24 * 60 * 60 * 1000); // 24 hours

    // Create session
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_sessions (
            id, initiator_user_id, title, description, status,
            review_period_hours, min_participants, created_at, expires_at, credits_held
        ) VALUES (?, ?, ?, ?, 'PENDING', ?, 2, ?, ?, 12)`,
        [
            sessionId,
            initiatorUserId,
            input.title || null,
            input.description || null,
            reviewHours,
            now,
            expiresAt,
        ]
    );

    // Create initiator participant
    const initiatorParticipantId = crypto.randomUUID();
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_participants (
            id, session_id, email, user_id, role,
            verified_at, agreement_status, created_at, joined_at
        ) VALUES (?, ?, ?, ?, 'INITIATOR', ?, 'PENDING', ?, ?)`,
        [
            initiatorParticipantId,
            sessionId,
            initiatorEmail,
            initiatorUserId,
            now, // Initiator is automatically verified
            now,
            now,
        ]
    );

    // Create counterparty participant (pending verification)
    const counterpartyParticipantId = crypto.randomUUID();
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_participants (
            id, session_id, email, role,
            verification_code, verification_expires_at, agreement_status, created_at
        ) VALUES (?, ?, ?, 'PARTICIPANT', ?, ?, 'PENDING', ?)`,
        [
            counterpartyParticipantId,
            sessionId,
            input.counterparty_email,
            verificationCode,
            verificationExpires,
            now,
        ]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        event_type: 'SESSION_CREATED',
        actor_type: 'INITIATOR',
        actor_identifier: initiatorUserId,
        details: JSON.stringify({
            counterparty_email: input.counterparty_email,
            review_period_hours: reviewHours,
        }),
    });

    // Send invitation email to counterparty
    await sendInvitationEmail(env, {
        sessionId,
        counterpartyEmail: input.counterparty_email,
        initiatorEmail,
        verificationCode,
        title: input.title,
        description: input.description,
    });

    await logEvent(env, {
        session_id: sessionId,
        participant_id: counterpartyParticipantId,
        event_type: 'INVITE_SENT',
        actor_type: 'SYSTEM',
        actor_identifier: 'system',
    });

    return getSessionResponse(env, sessionId, initiatorUserId);
}

// ============================================================================
// Get Session
// ============================================================================

export async function getSession(
    env: Env,
    sessionId: string,
    userId: string
): Promise<SessionResponse> {
    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    return getSessionResponse(env, sessionId, userId);
}

export async function getSessionById(
    env: Env,
    sessionId: string
): Promise<EnforcedSessionRow | null> {
    return queryOne<EnforcedSessionRow>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_sessions WHERE id = ?',
        [sessionId]
    );
}

export async function getSessionWithParticipants(
    env: Env,
    sessionId: string
): Promise<SessionWithParticipants | null> {
    const session = await getSessionById(env, sessionId);
    if (!session) return null;

    const participants = await query<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_participants WHERE session_id = ?',
        [sessionId]
    );

    return { ...session, participants };
}

// ============================================================================
// Get Session Status (polling endpoint)
// ============================================================================

export async function getSessionStatus(
    env: Env,
    sessionId: string,
    userId: string
): Promise<SessionStatusResponse> {
    const session = await getSessionWithParticipants(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    // Verify user is participant
    const isParticipant = session.participants.some(p => p.user_id === userId);
    if (!isParticipant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Get document count
    const docCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        'SELECT COUNT(*) as count FROM enforced_documents WHERE session_id = ? AND deleted_at IS NULL',
        [sessionId]
    );

    const allAgreed = session.participants
        .filter(p => p.role !== 'OBSERVER')
        .every(p => p.agreement_status === 'AGREED');

    const response: SessionStatusResponse = {
        status: session.status,
        all_agreed: allAgreed,
        participants: session.participants.map(p => ({
            email: maskEmail(p.email),
            role: p.role,
            verified: !!p.verified_at,
            agreed: p.agreement_status === 'AGREED',
        })),
        documents_count: docCount?.count || 0,
        expires_at: session.expires_at ? new Date(session.expires_at).toISOString() : null,
    };

    if (session.status === 'PARKED' && session.parked_at && session.parked_until) {
        response.parked = {
            at: new Date(session.parked_at).toISOString(),
            until: new Date(session.parked_until).toISOString(),
        };
    }

    return response;
}

// ============================================================================
// Update Session Status
// ============================================================================

export async function updateSessionStatus(
    env: Env,
    sessionId: string,
    status: string
): Promise<void> {
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE enforced_sessions SET status = ? WHERE id = ?',
        [status, sessionId]
    );
}

// ============================================================================
// Check Session Expiry
// ============================================================================

export async function checkAndExpireSessions(env: Env): Promise<number> {
    const now = Date.now();

    // Find expired sessions in PENDING or REVIEW status
    const expiredSessions = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT id FROM enforced_sessions
         WHERE status IN ('PENDING', 'REVIEW')
         AND expires_at < ?`,
        [now]
    );

    for (const session of expiredSessions) {
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE enforced_sessions SET status = 'EXPIRED' WHERE id = ?`,
            [session.id]
        );

        await logEvent(env, {
            session_id: session.id,
            event_type: 'SESSION_EXPIRED',
            actor_type: 'SYSTEM',
            actor_identifier: 'system',
        });
    }

    return expiredSessions.length;
}

// ============================================================================
// Helper Functions
// ============================================================================

export async function getParticipantByUserId(
    env: Env,
    sessionId: string,
    userId: string
): Promise<EnforcedParticipantRow | null> {
    return queryOne<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_participants WHERE session_id = ? AND user_id = ?',
        [sessionId, userId]
    );
}

export async function getParticipantByEmail(
    env: Env,
    sessionId: string,
    email: string
): Promise<EnforcedParticipantRow | null> {
    return queryOne<EnforcedParticipantRow>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enforced_participants WHERE session_id = ? AND email = ?',
        [sessionId, email.toLowerCase()]
    );
}

async function getSessionResponse(
    env: Env,
    sessionId: string,
    userId: string
): Promise<SessionResponse> {
    const session = await getSessionWithParticipants(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    const initiator = session.participants.find(p => p.role === 'INITIATOR');
    const counterparty = session.participants.find(p => p.role === 'PARTICIPANT');

    // Get documents
    const documents = await query<{
        id: string;
        file_name: string;
        file_size: number;
        mime_type: string | null;
        content_hash: string;
        uploaded_at: number;
        participant_id: string;
    }>(
        env.TATTLEHASH_DB,
        `SELECT d.id, d.file_name, d.file_size, d.mime_type, d.content_hash,
                d.uploaded_at, d.participant_id
         FROM enforced_documents d
         WHERE d.session_id = ? AND d.deleted_at IS NULL
         ORDER BY d.uploaded_at ASC`,
        [sessionId]
    );

    const currentParticipant = session.participants.find(p => p.user_id === userId);

    const response: SessionResponse = {
        id: session.id,
        title: session.title,
        description: session.description,
        status: session.status,
        initiator: {
            email: maskEmail(initiator!.email),
            agreed: initiator!.agreement_status === 'AGREED',
        },
        counterparty: counterparty ? {
            email: maskEmail(counterparty.email),
            verified: !!counterparty.verified_at,
            agreed: counterparty.agreement_status === 'AGREED',
        } : null,
        documents: documents.map(d => {
            const uploader = session.participants.find(p => p.id === d.participant_id);
            return {
                id: d.id,
                file_name: d.file_name,
                file_size: d.file_size,
                mime_type: d.mime_type,
                content_hash: d.content_hash,
                uploaded_at: new Date(d.uploaded_at).toISOString(),
                uploaded_by: maskEmail(uploader?.email || 'unknown'),
                is_own: d.participant_id === currentParticipant?.id,
            };
        }),
        review_period_hours: session.review_period_hours,
        created_at: new Date(session.created_at).toISOString(),
        expires_at: session.expires_at ? new Date(session.expires_at).toISOString() : null,
    };

    if (session.status === 'PARKED' && session.parked_at && session.parked_until) {
        const parkedBy = session.participants.find(p => p.id === session.parked_by_participant_id);
        response.parked = {
            at: new Date(session.parked_at).toISOString(),
            until: new Date(session.parked_until).toISOString(),
            reason: session.park_reason,
            by: maskEmail(parkedBy?.email || 'unknown'),
        };
    }

    if (session.attestation_id) {
        response.attestation = {
            id: session.attestation_id,
            tx_hash: session.anchor_tx_hash,
        };
    }

    return response;
}

function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const maskedLocal = local.charAt(0) + '***';
    const domainParts = domain.split('.');
    const maskedDomain = '***.' + domainParts[domainParts.length - 1];
    return `${maskedLocal}@${maskedDomain}`;
}

async function sendInvitationEmail(
    env: Env,
    data: {
        sessionId: string;
        counterpartyEmail: string;
        initiatorEmail: string;
        verificationCode: string;
        title?: string;
        description?: string;
    }
): Promise<void> {
    const verifyUrl = `https://tattlehash.com/enforced/verify?session=${data.sessionId}&code=${data.verificationCode}`;

    const subject = `${maskEmail(data.initiatorEmail)} has invited you to an Enforced attestation`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .header { text-align: center; margin-bottom: 32px; }
        .header h1 { color: #fff; font-size: 24px; margin: 0; }
        .card { background: #1a1a2e; border-radius: 12px; padding: 32px; margin-bottom: 24px; }
        .title { color: #00d4ff; font-size: 18px; font-weight: 600; margin-bottom: 8px; }
        .description { color: #a0a0a0; font-size: 14px; margin-bottom: 24px; }
        .code-box { background: #0a0a0f; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px; }
        .code { font-family: monospace; font-size: 32px; letter-spacing: 8px; color: #00d4ff; font-weight: bold; }
        .code-label { color: #a0a0a0; font-size: 12px; margin-bottom: 8px; }
        .btn { display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #00d4ff 100%); color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; }
        .or { text-align: center; color: #606060; margin: 16px 0; }
        .link { color: #00d4ff; word-break: break-all; }
        .footer { text-align: center; color: #606060; font-size: 12px; margin-top: 32px; }
        .warning { background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px; padding: 16px; margin-top: 16px; color: #ffc107; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>You've been invited to review documents</h1>
        </div>

        <div class="card">
            ${data.title ? `<div class="title">${escapeHtml(data.title)}</div>` : ''}
            ${data.description ? `<div class="description">${escapeHtml(data.description)}</div>` : ''}

            <div class="code-box">
                <div class="code-label">YOUR VERIFICATION CODE</div>
                <div class="code">${data.verificationCode}</div>
            </div>

            <div style="text-align: center;">
                <a href="${verifyUrl}" class="btn">Access Workspace</a>
            </div>

            <div class="or">or copy this link:</div>
            <div class="link">${verifyUrl}</div>

            <div class="warning">
                This invitation expires in 24 hours. You'll need to create a TattleHash account (or sign in) to participate.
            </div>
        </div>

        <div class="footer">
            <p>TattleHash - Immutable Evidence for the Digital Age</p>
            <p>You received this because someone invited you to review documents for a mutual attestation.</p>
        </div>
    </div>
</body>
</html>`;

    const text = `You've been invited to an Enforced attestation

${data.title ? `Title: ${data.title}\n` : ''}${data.description ? `Description: ${data.description}\n` : ''}

Your verification code: ${data.verificationCode}

Access the workspace: ${verifyUrl}

This invitation expires in 24 hours.

---
TattleHash - Immutable Evidence for the Digital Age`;

    await sendEmail(env, {
        to: data.counterpartyEmail,
        subject,
        html,
        text,
        tags: [
            { name: 'type', value: 'enforced_invitation' },
            { name: 'session_id', value: data.sessionId },
        ],
    });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
