/**
 * Enforced Document Management
 *
 * Upload, download, and manage documents in R2 storage.
 * Files are hashed during upload and deleted after session completion.
 */

import { execute, queryOne, query } from '../db';
import { createError } from '../errors';
import type { Env } from '../types';
import type {
    EnforcedDocumentRow,
    DocumentResponse,
    SignedUrlResponse,
    ENFORCED_LIMITS,
} from './types';
import { logEvent } from './events';
import { getSessionById, getParticipantByUserId } from './sessions';
import { resetOtherPartyAgreement } from './agreement';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES_PER_PARTICIPANT = 10;
const SIGNED_URL_EXPIRY = 15 * 60; // 15 minutes

// ============================================================================
// Upload Document
// ============================================================================

export async function uploadDocument(
    env: Env,
    sessionId: string,
    userId: string,
    file: ReadableStream<Uint8Array>,
    fileName: string,
    fileSize: number,
    mimeType?: string
): Promise<DocumentResponse> {
    const now = Date.now();

    // Verify session exists and is in REVIEW status
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (!['PENDING', 'REVIEW'].includes(session.status)) {
        throw createError('VALIDATION_ERROR', {
            message: 'Cannot upload documents in current session status'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Check file size
    if (fileSize > MAX_FILE_SIZE) {
        throw createError('VALIDATION_ERROR', {
            message: `File size exceeds maximum (${MAX_FILE_SIZE / 1024 / 1024}MB)`
        });
    }

    // Check participant file count
    const existingCount = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM enforced_documents
         WHERE session_id = ? AND participant_id = ? AND deleted_at IS NULL`,
        [sessionId, participant.id]
    );

    if (existingCount && existingCount.count >= MAX_FILES_PER_PARTICIPANT) {
        throw createError('VALIDATION_ERROR', {
            message: `Maximum ${MAX_FILES_PER_PARTICIPANT} files per participant`
        });
    }

    // Verify R2 bucket exists
    if (!env.ENFORCED_BUCKET) {
        throw createError('INTERNAL_ERROR', { message: 'Storage not configured' });
    }

    // Generate R2 key
    const docId = crypto.randomUUID();
    const sanitizedFileName = sanitizeFileName(fileName);
    const r2Key = `sessions/${sessionId}/${participant.id}/${docId}_${sanitizedFileName}`;

    // Stream to R2 and compute hash
    const { contentHash, bytesWritten } = await streamToR2WithHash(
        env.ENFORCED_BUCKET as any,
        r2Key,
        file as any,
        mimeType
    );

    // Verify file size matches
    if (bytesWritten !== fileSize) {
        // Delete the uploaded file
        await env.ENFORCED_BUCKET.delete(r2Key);
        throw createError('VALIDATION_ERROR', {
            message: 'File size mismatch during upload'
        });
    }

    // Save to database
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_documents (
            id, session_id, participant_id, r2_key, file_name,
            file_size, mime_type, content_hash, uploaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            docId,
            sessionId,
            participant.id,
            r2Key,
            fileName,
            bytesWritten,
            mimeType || null,
            contentHash,
            now,
        ]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'DOCUMENT_UPLOADED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
        details: JSON.stringify({
            document_id: docId,
            file_name: fileName,
            file_size: bytesWritten,
            content_hash: contentHash,
        }),
    });

    // Reset other party's agreement status (if they already agreed)
    await resetOtherPartyAgreement(env, sessionId, participant.id);

    return {
        id: docId,
        file_name: fileName,
        file_size: bytesWritten,
        mime_type: mimeType || null,
        content_hash: contentHash,
        uploaded_at: new Date(now).toISOString(),
        uploaded_by: participant.email,
        is_own: true,
    };
}

// ============================================================================
// Get Signed Download URL
// ============================================================================

export async function getDocumentUrl(
    env: Env,
    sessionId: string,
    documentId: string,
    userId: string
): Promise<SignedUrlResponse> {
    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Get document
    const doc = await queryOne<EnforcedDocumentRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_documents
         WHERE id = ? AND session_id = ? AND deleted_at IS NULL`,
        [documentId, sessionId]
    );

    if (!doc) {
        throw createError('NOT_FOUND', { message: 'Document not found' });
    }

    // Verify R2 bucket exists
    if (!env.ENFORCED_BUCKET) {
        throw createError('INTERNAL_ERROR', { message: 'Storage not configured' });
    }

    // Generate signed URL
    // Note: R2 doesn't have built-in signed URLs like S3, so we use a custom token approach
    // For now, we'll generate a presigned GET request
    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY * 1000);

    // Create a token that can be validated
    const token = await generateDownloadToken(env, sessionId, documentId, userId, expiresAt);

    // Log view event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'DOCUMENT_VIEWED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
        details: JSON.stringify({ document_id: documentId }),
    });

    return {
        url: `https://api.tattlehash.com/enforced/sessions/${sessionId}/documents/${documentId}/download?token=${token}`,
        expires_at: expiresAt.toISOString(),
    };
}

// ============================================================================
// Download Document (validate token and stream from R2)
// ============================================================================

export async function downloadDocument(
    env: Env,
    sessionId: string,
    documentId: string,
    token: string
): Promise<Response> {
    // Validate token
    const tokenData = await validateDownloadToken(env, token);
    if (!tokenData || tokenData.sessionId !== sessionId || tokenData.documentId !== documentId) {
        throw createError('FORBIDDEN', { message: 'Invalid or expired download token' });
    }

    // Get document
    const doc = await queryOne<EnforcedDocumentRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_documents
         WHERE id = ? AND session_id = ? AND deleted_at IS NULL`,
        [documentId, sessionId]
    );

    if (!doc) {
        throw createError('NOT_FOUND', { message: 'Document not found' });
    }

    // Verify R2 bucket exists
    if (!env.ENFORCED_BUCKET) {
        throw createError('INTERNAL_ERROR', { message: 'Storage not configured' });
    }

    // Get from R2
    const object = await env.ENFORCED_BUCKET.get(doc.r2_key);
    if (!object) {
        throw createError('NOT_FOUND', { message: 'File not found in storage' });
    }

    // Return file with proper headers
    return new Response(object.body as any, {
        headers: {
            'Content-Type': doc.mime_type || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.file_name)}"`,
            'Content-Length': doc.file_size.toString(),
            'Cache-Control': 'private, no-cache',
        },
    });
}

// ============================================================================
// Delete Document
// ============================================================================

export async function deleteDocument(
    env: Env,
    sessionId: string,
    documentId: string,
    userId: string
): Promise<void> {
    const now = Date.now();

    // Verify session
    const session = await getSessionById(env, sessionId);
    if (!session) {
        throw createError('NOT_FOUND', { message: 'Session not found' });
    }

    if (!['PENDING', 'REVIEW'].includes(session.status)) {
        throw createError('VALIDATION_ERROR', {
            message: 'Cannot delete documents in current session status'
        });
    }

    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Get document
    const doc = await queryOne<EnforcedDocumentRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_documents
         WHERE id = ? AND session_id = ? AND deleted_at IS NULL`,
        [documentId, sessionId]
    );

    if (!doc) {
        throw createError('NOT_FOUND', { message: 'Document not found' });
    }

    // Can only delete own documents
    if (doc.participant_id !== participant.id) {
        throw createError('FORBIDDEN', { message: 'Can only delete your own documents' });
    }

    // Delete from R2
    if (env.ENFORCED_BUCKET) {
        await env.ENFORCED_BUCKET.delete(doc.r2_key);
    }

    // Mark as deleted in DB
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE enforced_documents SET deleted_at = ? WHERE id = ?',
        [now, documentId]
    );

    // Log event
    await logEvent(env, {
        session_id: sessionId,
        participant_id: participant.id,
        event_type: 'DOCUMENT_DELETED',
        actor_type: participant.role === 'INITIATOR' ? 'INITIATOR' : 'PARTICIPANT',
        actor_identifier: userId,
        details: JSON.stringify({ document_id: documentId, file_name: doc.file_name }),
    });
}

// ============================================================================
// List Documents
// ============================================================================

export async function listDocuments(
    env: Env,
    sessionId: string,
    userId: string
): Promise<DocumentResponse[]> {
    // Verify user is participant
    const participant = await getParticipantByUserId(env, sessionId, userId);
    if (!participant) {
        throw createError('FORBIDDEN', { message: 'Not a participant in this session' });
    }

    // Get all documents with participant info
    const docs = await query<EnforcedDocumentRow & { participant_email: string }>(
        env.TATTLEHASH_DB,
        `SELECT d.*, p.email as participant_email
         FROM enforced_documents d
         JOIN enforced_participants p ON d.participant_id = p.id
         WHERE d.session_id = ? AND d.deleted_at IS NULL
         ORDER BY d.uploaded_at ASC`,
        [sessionId]
    );

    return docs.map(d => ({
        id: d.id,
        file_name: d.file_name,
        file_size: d.file_size,
        mime_type: d.mime_type,
        content_hash: d.content_hash,
        uploaded_at: new Date(d.uploaded_at).toISOString(),
        uploaded_by: maskEmail(d.participant_email),
        is_own: d.participant_id === participant.id,
    }));
}

// ============================================================================
// Get Documents for Completion (internal)
// ============================================================================

export async function getSessionDocuments(
    env: Env,
    sessionId: string
): Promise<EnforcedDocumentRow[]> {
    return query<EnforcedDocumentRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_documents
         WHERE session_id = ? AND deleted_at IS NULL
         ORDER BY uploaded_at ASC`,
        [sessionId]
    );
}

// ============================================================================
// Helper Functions
// ============================================================================

async function streamToR2WithHash(
    bucket: R2Bucket,
    key: string,
    stream: ReadableStream<Uint8Array>,
    mimeType?: string
): Promise<{ contentHash: string; bytesWritten: number }> {
    // We need to compute hash while streaming
    // Create a transform stream that accumulates data for hashing
    const chunks: Uint8Array[] = [];
    let bytesWritten = 0;

    const reader = stream.getReader();
    const allChunks: Uint8Array[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allChunks.push(value);
        bytesWritten += value.length;
    }

    // Combine all chunks
    const fullData = new Uint8Array(bytesWritten);
    let offset = 0;
    for (const chunk of allChunks) {
        fullData.set(chunk, offset);
        offset += chunk.length;
    }

    // Compute hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', fullData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Upload to R2
    await bucket.put(key, fullData, {
        httpMetadata: mimeType ? { contentType: mimeType } : undefined,
    });

    return { contentHash, bytesWritten };
}

function sanitizeFileName(fileName: string): string {
    // Remove path separators and null bytes
    return fileName
        .replace(/[/\\]/g, '_')
        .replace(/\0/g, '')
        .slice(0, 255);
}

function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const maskedLocal = local.charAt(0) + '***';
    const domainParts = domain.split('.');
    const maskedDomain = '***.' + domainParts[domainParts.length - 1];
    return `${maskedLocal}@${maskedDomain}`;
}

async function generateDownloadToken(
    env: Env,
    sessionId: string,
    documentId: string,
    userId: string,
    expiresAt: Date
): Promise<string> {
    const tokenId = crypto.randomUUID();
    const tokenData = {
        sessionId,
        documentId,
        userId,
        expiresAt: expiresAt.getTime(),
    };

    // Store in KV with expiration
    await env.GATE_KV.put(
        `enforced:download:${tokenId}`,
        JSON.stringify(tokenData),
        { expirationTtl: SIGNED_URL_EXPIRY }
    );

    return tokenId;
}

async function validateDownloadToken(
    env: Env,
    token: string
): Promise<{ sessionId: string; documentId: string; userId: string } | null> {
    const data = await env.GATE_KV.get(`enforced:download:${token}`, 'json');
    if (!data) return null;

    const tokenData = data as {
        sessionId: string;
        documentId: string;
        userId: string;
        expiresAt: number;
    };

    if (Date.now() > tokenData.expiresAt) {
        return null;
    }

    return {
        sessionId: tokenData.sessionId,
        documentId: tokenData.documentId,
        userId: tokenData.userId,
    };
}
