/**
 * Enforced Document Review Sessions HTTP Handlers
 *
 * Two-party document review with R2 storage and mutual agreement.
 */

import { ok, err } from '../lib/http';
import { getFlag } from '../lib/flags';
import { authenticateRequest } from '../middleware/auth';
import type { Env } from '../types';
import { z } from 'zod';
import {
    createSession,
    getSessionStatus,
} from '../enforced/sessions';
import {
    verifyParticipant,
    joinSession,
    resendVerificationCode,
} from '../enforced/participants';
import {
    uploadDocument,
    getDocumentUrl,
    downloadDocument,
    deleteDocument,
    listDocuments,
} from '../enforced/documents';
import {
    submitAgreement,
    submitDecline,
    getAgreementStatus,
} from '../enforced/agreement';
import {
    requestPark,
    resumeSession,
} from '../enforced/park';
import { getSessionEvents } from '../enforced/events';
import { query } from '../db';

// ============================================================================
// Schema Definitions
// ============================================================================

const CreateSessionSchema = z.object({
    counterparty_email: z.string().email(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    temperature: z.enum(['STRICT', 'FORMAL', 'BALANCED', 'FLUID']).optional(),
    review_period_hours: z.number().min(24).max(168).optional(),
});

const VerifyParticipantSchema = z.object({
    code: z.string().length(6),
});

const DeclineSchema = z.object({
    reason: z.string().max(2000).optional(),
});

const ParkSchema = z.object({
    duration: z.enum(['24h', '72h', '7d', '14d', '30d']),
    reason: z.string().max(1000).optional(),
});

// ============================================================================
// POST /enforced/sessions - Create New Session
// ============================================================================

export async function postCreateSession(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = CreateSessionSchema.parse(body);

        const session = await createSession(env, userId, {
            counterparty_email: data.counterparty_email,
            title: data.title,
            description: data.description,
            temperature: data.temperature,
            review_period_hours: data.review_period_hours,
        });

        return ok(session, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Create enforced session error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions - List User's Sessions
// ============================================================================

export async function getListSessions(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0');

        // Query sessions where user is a participant
        let sql = `
            SELECT s.* FROM enforced_sessions s
            JOIN enforced_participants p ON s.id = p.session_id
            WHERE p.user_id = ?
        `;
        const params: any[] = [userId];

        if (status) {
            sql += ' AND s.status = ?';
            params.push(status);
        }

        sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const sessions = await query(env.TATTLEHASH_DB, sql, params);

        return ok({ sessions });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('List enforced sessions error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id - Get Session Details
// ============================================================================

export async function getSession(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const session = await getSessionStatus(env, sessionId, userId);
        return ok(session);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get enforced session error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/verify - Verify Email Code (Counterparty)
// ============================================================================

export async function postVerifyParticipant(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json();
        const data = VerifyParticipantSchema.parse(body);

        const result = await verifyParticipant(env, sessionId, { code: data.code });

        return ok(result);
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Verify participant error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/join - Join Session After Verification
// ============================================================================

export async function postJoinSession(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        await joinSession(env, sessionId, userId);
        return ok({ joined: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Join session error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/resend-code - Resend Verification Code
// ============================================================================

export async function postResendCode(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        await resendVerificationCode(env, sessionId, userId);
        return ok({ sent: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Resend code error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/documents - Upload Document
// ============================================================================

export async function postUploadDocument(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        // Get file info from headers
        const contentLength = request.headers.get('Content-Length');
        const contentType = request.headers.get('Content-Type');
        const fileName = request.headers.get('X-File-Name') || 'document';

        if (!contentLength) {
            return err(400, 'VALIDATION_ERROR', { message: 'Content-Length header required' });
        }

        const fileSize = parseInt(contentLength);
        if (isNaN(fileSize) || fileSize <= 0) {
            return err(400, 'VALIDATION_ERROR', { message: 'Invalid file size' });
        }

        if (!request.body) {
            return err(400, 'VALIDATION_ERROR', { message: 'Request body required' });
        }

        const document = await uploadDocument(
            env,
            sessionId,
            userId,
            request.body as any,
            decodeURIComponent(fileName),
            fileSize,
            contentType || undefined
        );

        return ok(document, { status: 201 });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Upload document error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id/documents - List Documents
// ============================================================================

export async function getListDocuments(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const documents = await listDocuments(env, sessionId, userId);
        return ok({ documents });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('List documents error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id/documents/:docId/url - Get Signed Download URL
// ============================================================================

export async function getDocumentDownloadUrl(
    request: Request,
    env: Env,
    sessionId: string,
    documentId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await getDocumentUrl(env, sessionId, documentId, userId);
        return ok(result);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get document URL error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id/documents/:docId/download - Download Document
// ============================================================================

export async function getDownloadDocument(
    request: Request,
    env: Env,
    sessionId: string,
    documentId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const url = new URL(request.url);
        const token = url.searchParams.get('token');

        if (!token) {
            return err(400, 'VALIDATION_ERROR', { message: 'Download token required' });
        }

        return await downloadDocument(env, sessionId, documentId, token);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Download document error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// DELETE /enforced/sessions/:id/documents/:docId - Delete Document
// ============================================================================

export async function deleteDocumentHandler(
    request: Request,
    env: Env,
    sessionId: string,
    documentId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        await deleteDocument(env, sessionId, documentId, userId);
        return ok({ deleted: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Delete document error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/agree - Submit Agreement
// ============================================================================

export async function postAgree(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await submitAgreement(env, sessionId, userId);
        return ok(result);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Submit agreement error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/decline - Submit Decline
// ============================================================================

export async function postDecline(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json().catch(() => ({}));
        const data = DeclineSchema.parse(body);

        await submitDecline(env, sessionId, userId, { reason: data.reason });
        return ok({ declined: true });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Submit decline error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id/status - Get Agreement Status
// ============================================================================

export async function getAgreementStatusHandler(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    try {
        const status = await getAgreementStatus(env, sessionId);
        return ok({ participants: status });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get agreement status error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/park - Request Park
// ============================================================================

export async function postPark(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = ParkSchema.parse(body);

        const result = await requestPark(env, sessionId, userId, {
            duration: data.duration,
            reason: data.reason,
        });

        return ok(result);
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return err(400, 'VALIDATION_ERROR', { errors: e.issues });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Park session error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enforced/sessions/:id/resume - Resume from Park
// ============================================================================

export async function postResume(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        await resumeSession(env, sessionId, userId);
        return ok({ resumed: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Resume session error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enforced/sessions/:id/events - Get Session Events (Audit Trail)
// ============================================================================

export async function getEvents(
    request: Request,
    env: Env,
    sessionId: string
): Promise<Response> {
    if (!getFlag('ENFORCED_SESSIONS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        // Verify user is participant (implicitly done by getSessionStatus)
        await getSessionStatus(env, sessionId, userId);

        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const events = await getSessionEvents(env, sessionId, limit, offset);

        return ok({
            events: events.map((e: any) => ({
                id: e.id,
                event_type: e.event_type,
                actor_type: e.actor_type,
                actor_identifier: e.actor_identifier,
                details: e.details ? JSON.parse(e.details) : null,
                created_at: new Date(e.created_at).toISOString(),
            })),
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get events error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
