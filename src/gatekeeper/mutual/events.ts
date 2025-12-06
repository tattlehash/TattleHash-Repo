/**
 * Gatekeeper Event Logging
 */

import { execute } from '../../db';
import type { Env } from '../../types';
import type { EventType } from './types';

export interface LogEventInput {
    session_id?: string;
    user_verification_id?: string;
    event_type: EventType | string;
    actor_type?: string;
    actor_identifier?: string;
    details?: string;
}

export async function logEvent(env: Env, input: LogEventInput): Promise<void> {
    const eventId = `gke_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO gatekeeper_events
         (id, session_id, user_verification_id, event_type, actor_type, actor_identifier, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            eventId,
            input.session_id || null,
            input.user_verification_id || null,
            input.event_type,
            input.actor_type || null,
            input.actor_identifier || null,
            input.details || null,
            now,
        ]
    );
}
