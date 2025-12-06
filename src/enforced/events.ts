/**
 * Enforced Event Logging
 *
 * Immutable audit trail for enforced sessions.
 */

import { execute, query } from '../db';
import type { Env } from '../types';
import type { EventType, ActorType, EnforcedEventRow } from './types';

export interface LogEventInput {
    session_id: string;
    participant_id?: string;
    event_type: EventType;
    actor_type: ActorType;
    actor_identifier?: string;
    details?: string;
    ip_address?: string;
    user_agent?: string;
}

export async function logEvent(
    env: Env,
    input: LogEventInput
): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enforced_events (
            id, session_id, participant_id, event_type, actor_type,
            actor_identifier, details, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            input.session_id,
            input.participant_id || null,
            input.event_type,
            input.actor_type,
            input.actor_identifier || null,
            input.details || null,
            input.ip_address || null,
            input.user_agent || null,
            now,
        ]
    );
}

export async function getSessionEvents(
    env: Env,
    sessionId: string,
    limit: number = 100,
    offset: number = 0
): Promise<EnforcedEventRow[]> {
    return query<EnforcedEventRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enforced_events
         WHERE session_id = ?
         ORDER BY created_at ASC
         LIMIT ? OFFSET ?`,
        [sessionId, limit, offset]
    );
}
