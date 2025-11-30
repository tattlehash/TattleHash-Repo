/**
 * ENF Audit Trail Events
 *
 * Immutable event logging for court-admissible evidence chain.
 */

import { execute, query } from '../db';
import { Env } from '../types';
import type { EnfEvent, EnfEventType, EnfActorType } from '../db/types';

// ============================================================================
// Event Logging
// ============================================================================

export interface LogEventInput {
    enf_id: string;
    recipient_id?: string;
    event_type: EnfEventType;
    actor_type: EnfActorType;
    actor_identifier?: string;
    details?: string;
    ip_address?: string;
    user_agent?: string;
}

export async function logEnfEvent(
    env: Env,
    input: LogEventInput
): Promise<EnfEvent> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enf_events (
            id, enf_id, recipient_id, event_type, actor_type,
            actor_identifier, details, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            input.enf_id,
            input.recipient_id ?? null,
            input.event_type,
            input.actor_type,
            input.actor_identifier ?? null,
            input.details ?? null,
            input.ip_address ?? null,
            input.user_agent ?? null,
            now,
        ]
    );

    return {
        id,
        enf_id: input.enf_id,
        recipient_id: input.recipient_id,
        event_type: input.event_type,
        actor_type: input.actor_type,
        actor_identifier: input.actor_identifier,
        details: input.details,
        ip_address: input.ip_address,
        user_agent: input.user_agent,
        created_at: now,
    };
}

// ============================================================================
// Event Retrieval
// ============================================================================

export async function getEventsByBundle(
    env: Env,
    bundleId: string,
    options: { limit?: number; offset?: number; event_type?: EnfEventType } = {}
): Promise<EnfEvent[]> {
    const { limit = 100, offset = 0, event_type } = options;

    let sql = 'SELECT * FROM enf_events WHERE enf_id = ?';
    const params: any[] = [bundleId];

    if (event_type) {
        sql += ' AND event_type = ?';
        params.push(event_type);
    }

    sql += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return query<EnfEvent>(env.TATTLEHASH_DB, sql, params);
}

export async function getEventsByRecipient(
    env: Env,
    recipientId: string
): Promise<EnfEvent[]> {
    return query<EnfEvent>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_events WHERE recipient_id = ? ORDER BY created_at ASC',
        [recipientId]
    );
}

// ============================================================================
// Audit Export
// ============================================================================

export interface AuditExport {
    bundle_id: string;
    exported_at: string;
    events: AuditEventRecord[];
    hash: string;
}

export interface AuditEventRecord {
    timestamp: string;
    event_type: string;
    actor_type: string;
    actor: string | null;
    recipient_id: string | null;
    details: Record<string, unknown> | null;
}

export async function exportBundleAuditTrail(
    env: Env,
    bundleId: string
): Promise<AuditExport> {
    const events = await getEventsByBundle(env, bundleId, { limit: 1000 });

    const auditRecords: AuditEventRecord[] = events.map(e => ({
        timestamp: new Date(e.created_at).toISOString(),
        event_type: e.event_type,
        actor_type: e.actor_type,
        actor: e.actor_identifier ?? null,
        recipient_id: e.recipient_id ?? null,
        details: e.details ? JSON.parse(e.details) : null,
    }));

    // Create hash of audit trail for integrity verification
    const auditString = JSON.stringify(auditRecords);
    const encoder = new TextEncoder();
    const data = encoder.encode(auditString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return {
        bundle_id: bundleId,
        exported_at: new Date().toISOString(),
        events: auditRecords,
        hash,
    };
}
