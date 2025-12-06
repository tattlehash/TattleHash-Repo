/**
 * Enforced Session Cleanup
 *
 * Delete files from R2 after session completion, void, or expiry.
 * Also handles scheduled cleanup for safety.
 */

import { execute, queryOne, query } from '../db';
import type { Env } from '../types';
import type { EnforcedDocumentRow, EnforcedSessionRow } from './types';
import { logEvent } from './events';

// ============================================================================
// Cleanup Session Files
// ============================================================================

export async function cleanupSessionFiles(
    env: Env,
    sessionId: string
): Promise<number> {
    const now = Date.now();

    // Get all documents not yet deleted
    const documents = await query<EnforcedDocumentRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_documents
         WHERE session_id = ? AND deleted_at IS NULL`,
        [sessionId]
    );

    if (documents.length === 0) {
        return 0;
    }

    // Verify R2 bucket exists
    if (!env.ENFORCED_BUCKET) {
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'enforced_cleanup_no_bucket',
            session_id: sessionId,
        }));
        return 0;
    }

    let deletedCount = 0;

    // Delete each file from R2
    for (const doc of documents) {
        try {
            await env.ENFORCED_BUCKET.delete(doc.r2_key);
            deletedCount++;
        } catch (error) {
            console.error(JSON.stringify({
                t: Date.now(),
                at: 'enforced_file_delete_failed',
                session_id: sessionId,
                document_id: doc.id,
                r2_key: doc.r2_key,
                error: String(error),
            }));
        }
    }

    // Mark all documents as deleted in DB
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enforced_documents
         SET deleted_at = ?
         WHERE session_id = ? AND deleted_at IS NULL`,
        [now, sessionId]
    );

    // Log cleanup event
    await logEvent(env, {
        session_id: sessionId,
        event_type: 'CLEANUP_COMPLETED',
        actor_type: 'SYSTEM',
        actor_identifier: 'system',
        details: JSON.stringify({
            documents_deleted: deletedCount,
        }),
    });

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enforced_cleanup_completed',
        session_id: sessionId,
        documents_deleted: deletedCount,
    }));

    return deletedCount;
}

// ============================================================================
// Scheduled Cleanup Worker
// ============================================================================

export async function runScheduledCleanup(env: Env): Promise<{
    sessionsProcessed: number;
    filesDeleted: number;
}> {
    let sessionsProcessed = 0;
    let filesDeleted = 0;

    // Find sessions needing cleanup:
    // 1. AGREED, VOID, or EXPIRED status
    // 2. Have documents not yet deleted
    const sessionsNeedingCleanup = await query<{ id: string; status: string }>(
        env.TATTLEHASH_DB,
        `SELECT DISTINCT s.id, s.status
         FROM enforced_sessions s
         JOIN enforced_documents d ON s.id = d.session_id
         WHERE s.status IN ('AGREED', 'VOID', 'EXPIRED')
         AND d.deleted_at IS NULL`,
        []
    );

    for (const session of sessionsNeedingCleanup) {
        const deleted = await cleanupSessionFiles(env, session.id);
        sessionsProcessed++;
        filesDeleted += deleted;
    }

    // Also check for expired sessions in REVIEW status
    const now = Date.now();
    const expiredReviewSessions = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT id FROM enforced_sessions
         WHERE status = 'REVIEW' AND expires_at < ?`,
        [now]
    );

    for (const session of expiredReviewSessions) {
        // Mark as expired
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

        // Cleanup files
        const deleted = await cleanupSessionFiles(env, session.id);
        sessionsProcessed++;
        filesDeleted += deleted;
    }

    // Check for pending sessions with expired verification
    const pendingExpired = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT DISTINCT s.id
         FROM enforced_sessions s
         JOIN enforced_participants p ON s.id = p.session_id
         WHERE s.status = 'PENDING'
         AND p.verified_at IS NULL
         AND p.verification_expires_at < ?`,
        [now]
    );

    for (const session of pendingExpired) {
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
            details: JSON.stringify({ reason: 'verification_timeout' }),
        });

        const deleted = await cleanupSessionFiles(env, session.id);
        sessionsProcessed++;
        filesDeleted += deleted;
    }

    if (sessionsProcessed > 0 || filesDeleted > 0) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'enforced_scheduled_cleanup',
            sessions_processed: sessionsProcessed,
            files_deleted: filesDeleted,
        }));
    }

    return { sessionsProcessed, filesDeleted };
}

// ============================================================================
// Delete All Session Data (for complete removal)
// ============================================================================

export async function deleteSessionCompletely(
    env: Env,
    sessionId: string
): Promise<void> {
    // First cleanup files
    await cleanupSessionFiles(env, sessionId);

    // Delete events
    await execute(
        env.TATTLEHASH_DB,
        'DELETE FROM enforced_events WHERE session_id = ?',
        [sessionId]
    );

    // Delete documents
    await execute(
        env.TATTLEHASH_DB,
        'DELETE FROM enforced_documents WHERE session_id = ?',
        [sessionId]
    );

    // Delete participants
    await execute(
        env.TATTLEHASH_DB,
        'DELETE FROM enforced_participants WHERE session_id = ?',
        [sessionId]
    );

    // Delete session
    await execute(
        env.TATTLEHASH_DB,
        'DELETE FROM enforced_sessions WHERE id = ?',
        [sessionId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enforced_session_deleted',
        session_id: sessionId,
    }));
}

// ============================================================================
// R2 Lifecycle Verification (safety check)
// ============================================================================

export async function verifyR2Lifecycle(env: Env): Promise<void> {
    // List objects in R2 bucket older than 7 days
    // This is a safety net - files should be deleted much sooner

    if (!env.ENFORCED_BUCKET) {
        return;
    }

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    // R2 list doesn't support filtering by age, so we'd need to
    // iterate and check each object's httpMetadata.cacheExpiry or custom metadata
    // For now, this is a placeholder for the R2 lifecycle policy

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enforced_r2_lifecycle_check',
        cutoff: new Date(sevenDaysAgo).toISOString(),
    }));
}
