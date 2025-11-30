/**
 * ENF Core Operations
 *
 * Bundle creation, recipient management, and state transitions.
 */

import { execute, query, queryOne } from '../db';
import { createError } from '../errors';
import { sha256 } from '../utils/crypto';
import { Env } from '../types';
import type {
    EnfBundle,
    EnfRecipient,
    EnfBundleStatus,
    EnfRecipientStatus,
} from '../db/types';
import {
    CreateEnfBundleInput,
    ENF_DEFAULTS,
    canTransitionBundle,
    canTransitionRecipient,
} from './types';
import { logEnfEvent } from './events';

// ============================================================================
// Bundle Creation
// ============================================================================

export interface CreateBundleResult {
    bundle: EnfBundle;
    recipients: EnfRecipient[];
}

export async function createEnfBundle(
    env: Env,
    userId: string,
    input: CreateEnfBundleInput
): Promise<CreateBundleResult> {
    const now = Date.now();
    const bundleId = crypto.randomUUID();
    const expiryMs = input.expiry_ms ?? ENF_DEFAULTS.DEFAULT_EXPIRY_MS;

    // Validate evidence size
    const evidenceStr = JSON.stringify(input.evidence);
    if (evidenceStr.length > ENF_DEFAULTS.MAX_EVIDENCE_SIZE) {
        throw createError('VALIDATION_ERROR', {
            message: `Evidence payload exceeds maximum size of ${ENF_DEFAULTS.MAX_EVIDENCE_SIZE} bytes`,
        });
    }

    // Create canonical evidence hash
    const evidenceBytes = await sha256(evidenceStr);
    const evidenceHash = Array.from(evidenceBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Insert bundle
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enf_bundles (
            id, initiator_user_id, initiator_wallet, title, description,
            evidence_hash, evidence_payload, status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            bundleId,
            userId,
            input.initiator_wallet ?? null,
            input.title,
            input.description ?? null,
            evidenceHash,
            evidenceStr,
            'DRAFT',
            now + expiryMs,
            now,
            now,
        ]
    );

    // Create recipients
    const recipients: EnfRecipient[] = [];
    for (const recipientInput of input.recipients) {
        const recipientId = crypto.randomUUID();
        const deliveryToken = generateDeliveryToken();

        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO enf_recipients (
                id, enf_id, counterparty_type, counterparty_identifier,
                delivery_token, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                recipientId,
                bundleId,
                recipientInput.type,
                recipientInput.identifier,
                deliveryToken,
                'PENDING',
                now,
                now,
            ]
        );

        recipients.push({
            id: recipientId,
            enf_id: bundleId,
            counterparty_type: recipientInput.type,
            counterparty_identifier: recipientInput.identifier,
            delivery_token: deliveryToken,
            status: 'PENDING',
            created_at: now,
            updated_at: now,
        });
    }

    // Log creation event
    await logEnfEvent(env, {
        enf_id: bundleId,
        event_type: 'CREATED',
        actor_type: 'INITIATOR',
        actor_identifier: userId,
        details: JSON.stringify({
            title: input.title,
            recipient_count: recipients.length,
            expires_at: now + expiryMs,
        }),
    });

    console.log(JSON.stringify({
        t: now,
        at: 'enf_bundle_created',
        bundle_id: bundleId,
        initiator: userId,
        recipient_count: recipients.length,
        evidence_hash: evidenceHash,
    }));

    const bundle: EnfBundle = {
        id: bundleId,
        initiator_user_id: userId,
        initiator_wallet: input.initiator_wallet,
        title: input.title,
        description: input.description,
        evidence_hash: evidenceHash,
        evidence_payload: evidenceStr,
        status: 'DRAFT',
        expires_at: now + expiryMs,
        created_at: now,
        updated_at: now,
    };

    return { bundle, recipients };
}

// ============================================================================
// Bundle Retrieval
// ============================================================================

export async function getEnfBundle(
    env: Env,
    bundleId: string,
    userId?: string
): Promise<EnfBundle | null> {
    const sql = userId
        ? 'SELECT * FROM enf_bundles WHERE id = ? AND initiator_user_id = ?'
        : 'SELECT * FROM enf_bundles WHERE id = ?';
    const params = userId ? [bundleId, userId] : [bundleId];

    return queryOne<EnfBundle>(env.TATTLEHASH_DB, sql, params);
}

export async function listEnfBundles(
    env: Env,
    userId: string,
    options: { limit?: number; offset?: number; status?: EnfBundleStatus } = {}
): Promise<EnfBundle[]> {
    const { limit = 50, offset = 0, status } = options;

    let sql = 'SELECT * FROM enf_bundles WHERE initiator_user_id = ?';
    const params: any[] = [userId];

    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return query<EnfBundle>(env.TATTLEHASH_DB, sql, params);
}

// ============================================================================
// Recipient Operations
// ============================================================================

export async function getRecipientsByBundle(
    env: Env,
    bundleId: string
): Promise<EnfRecipient[]> {
    return query<EnfRecipient>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_recipients WHERE enf_id = ? ORDER BY created_at',
        [bundleId]
    );
}

export async function getRecipientByToken(
    env: Env,
    token: string
): Promise<EnfRecipient | null> {
    return queryOne<EnfRecipient>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_recipients WHERE delivery_token = ?',
        [token]
    );
}

export async function getRecipientById(
    env: Env,
    recipientId: string
): Promise<EnfRecipient | null> {
    return queryOne<EnfRecipient>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_recipients WHERE id = ?',
        [recipientId]
    );
}

// ============================================================================
// Status Updates
// ============================================================================

export async function updateBundleStatus(
    env: Env,
    bundleId: string,
    newStatus: EnfBundleStatus,
    actorType: 'INITIATOR' | 'RECIPIENT' | 'SYSTEM',
    actorIdentifier?: string
): Promise<void> {
    const bundle = await getEnfBundle(env, bundleId);
    if (!bundle) {
        throw createError('NOT_FOUND', { resource: 'enf_bundle' });
    }

    if (!canTransitionBundle(bundle.status, newStatus)) {
        throw createError('ENF_INVALID_TRANSITION', {
            from: bundle.status,
            to: newStatus,
        });
    }

    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE enf_bundles SET status = ?, updated_at = ? WHERE id = ?',
        [newStatus, now, bundleId]
    );

    await logEnfEvent(env, {
        enf_id: bundleId,
        event_type: newStatus === 'CANCELLED' ? 'CANCELLED' : 'UPDATED',
        actor_type: actorType,
        actor_identifier: actorIdentifier,
        details: JSON.stringify({ new_status: newStatus }),
    });

    console.log(JSON.stringify({
        t: now,
        at: 'enf_bundle_status_updated',
        bundle_id: bundleId,
        old_status: bundle.status,
        new_status: newStatus,
    }));
}

export async function updateRecipientStatus(
    env: Env,
    recipientId: string,
    newStatus: EnfRecipientStatus,
    actorType: 'INITIATOR' | 'RECIPIENT' | 'SYSTEM',
    actorIdentifier?: string,
    additionalFields?: Partial<EnfRecipient>
): Promise<void> {
    const recipient = await getRecipientById(env, recipientId);
    if (!recipient) {
        throw createError('NOT_FOUND', { resource: 'enf_recipient' });
    }

    if (!canTransitionRecipient(recipient.status, newStatus)) {
        throw createError('ENF_INVALID_TRANSITION', {
            from: recipient.status,
            to: newStatus,
        });
    }

    const now = Date.now();
    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const params: any[] = [newStatus, now];

    if (newStatus === 'SENT' && !recipient.sent_at) {
        updates.push('sent_at = ?');
        params.push(now);
    }
    if (newStatus === 'DELIVERED' && !recipient.delivered_at) {
        updates.push('delivered_at = ?');
        params.push(now);
    }
    if ((newStatus === 'ACKNOWLEDGED' || newStatus === 'DECLINED') && !recipient.responded_at) {
        updates.push('responded_at = ?');
        params.push(now);
    }
    if (additionalFields?.response_message !== undefined) {
        updates.push('response_message = ?');
        params.push(additionalFields.response_message);
    }
    if (additionalFields?.delivery_link !== undefined) {
        updates.push('delivery_link = ?');
        params.push(additionalFields.delivery_link);
    }

    params.push(recipientId);

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enf_recipients SET ${updates.join(', ')} WHERE id = ?`,
        params
    );

    // Map status to event type
    const eventTypeMap: Record<string, string> = {
        'SENT': 'SENT',
        'DELIVERED': 'DELIVERED',
        'ACKNOWLEDGED': 'ACKNOWLEDGED',
        'DECLINED': 'DECLINED',
        'EXPIRED': 'EXPIRED',
    };

    await logEnfEvent(env, {
        enf_id: recipient.enf_id,
        recipient_id: recipientId,
        event_type: eventTypeMap[newStatus] as any,
        actor_type: actorType,
        actor_identifier: actorIdentifier,
        details: JSON.stringify({ new_status: newStatus }),
    });

    console.log(JSON.stringify({
        t: now,
        at: 'enf_recipient_status_updated',
        recipient_id: recipientId,
        enf_id: recipient.enf_id,
        old_status: recipient.status,
        new_status: newStatus,
    }));

    // Check if bundle status should be updated
    await updateBundleStatusFromRecipients(env, recipient.enf_id);
}

// ============================================================================
// Bundle Status Calculation
// ============================================================================

async function updateBundleStatusFromRecipients(
    env: Env,
    bundleId: string
): Promise<void> {
    const bundle = await getEnfBundle(env, bundleId);
    if (!bundle || bundle.status === 'CANCELLED' || bundle.status === 'EXPIRED') {
        return;
    }

    const recipients = await getRecipientsByBundle(env, bundleId);
    if (recipients.length === 0) return;

    const allResponded = recipients.every(
        r => r.status === 'ACKNOWLEDGED' || r.status === 'DECLINED' || r.status === 'EXPIRED'
    );
    const someResponded = recipients.some(
        r => r.status === 'ACKNOWLEDGED' || r.status === 'DECLINED'
    );
    const anySent = recipients.some(
        r => r.status !== 'PENDING'
    );

    let newStatus: EnfBundleStatus | null = null;

    if (allResponded) {
        newStatus = 'COMPLETE';
    } else if (someResponded && bundle.status !== 'PARTIAL') {
        newStatus = 'PARTIAL';
    } else if (anySent && bundle.status === 'DRAFT') {
        newStatus = 'SENT';
    }

    if (newStatus && newStatus !== bundle.status) {
        await execute(
            env.TATTLEHASH_DB,
            'UPDATE enf_bundles SET status = ?, updated_at = ? WHERE id = ?',
            [newStatus, Date.now(), bundleId]
        );

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'enf_bundle_status_auto_updated',
            bundle_id: bundleId,
            old_status: bundle.status,
            new_status: newStatus,
        }));
    }
}

// ============================================================================
// Send Bundle
// ============================================================================

export async function sendEnfBundle(
    env: Env,
    bundleId: string,
    userId: string,
    baseUrl: string
): Promise<{ sent_count: number; recipients: EnfRecipient[] }> {
    const bundle = await getEnfBundle(env, bundleId, userId);
    if (!bundle) {
        throw createError('NOT_FOUND', { resource: 'enf_bundle' });
    }

    if (bundle.status !== 'DRAFT') {
        throw createError('ENF_ALREADY_SENT', {
            message: 'Bundle has already been sent',
        });
    }

    const recipients = await getRecipientsByBundle(env, bundleId);
    if (recipients.length === 0) {
        throw createError('ENF_NO_RECIPIENTS', {
            message: 'Bundle has no recipients',
        });
    }

    let sentCount = 0;
    const updatedRecipients: EnfRecipient[] = [];

    for (const recipient of recipients) {
        if (recipient.status !== 'PENDING') continue;

        // Generate delivery link
        const deliveryLink = `${baseUrl}/enf/view/${recipient.delivery_token}`;

        // Update recipient with delivery link and mark as sent
        await updateRecipientStatus(
            env,
            recipient.id,
            'SENT',
            'INITIATOR',
            userId,
            { delivery_link: deliveryLink }
        );

        sentCount++;
        updatedRecipients.push({
            ...recipient,
            status: 'SENT',
            delivery_link: deliveryLink,
            sent_at: Date.now(),
        });

        // TODO: Integrate with actual delivery service (email, push notification)
        // For now, the delivery_link is generated and can be shared manually
    }

    // Update bundle status to SENT
    await updateBundleStatus(env, bundleId, 'SENT', 'INITIATOR', userId);

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enf_bundle_sent',
        bundle_id: bundleId,
        sent_count: sentCount,
    }));

    return { sent_count: sentCount, recipients: updatedRecipients };
}

// ============================================================================
// Cancel Bundle
// ============================================================================

export async function cancelEnfBundle(
    env: Env,
    bundleId: string,
    userId: string,
    reason?: string
): Promise<void> {
    const bundle = await getEnfBundle(env, bundleId, userId);
    if (!bundle) {
        throw createError('NOT_FOUND', { resource: 'enf_bundle' });
    }

    if (bundle.status === 'COMPLETE' || bundle.status === 'CANCELLED' || bundle.status === 'EXPIRED') {
        throw createError('ENF_CANNOT_CANCEL', {
            message: `Cannot cancel bundle with status ${bundle.status}`,
        });
    }

    await updateBundleStatus(env, bundleId, 'CANCELLED', 'INITIATOR', userId);

    // Expire all pending recipients
    const recipients = await getRecipientsByBundle(env, bundleId);
    for (const recipient of recipients) {
        if (recipient.status === 'PENDING' || recipient.status === 'SENT' || recipient.status === 'DELIVERED') {
            await execute(
                env.TATTLEHASH_DB,
                'UPDATE enf_recipients SET status = ?, updated_at = ? WHERE id = ?',
                ['EXPIRED', Date.now(), recipient.id]
            );
        }
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enf_bundle_cancelled',
        bundle_id: bundleId,
        reason,
    }));
}

// ============================================================================
// Expiration Check
// ============================================================================

export async function checkExpiredBundles(env: Env): Promise<number> {
    const now = Date.now();
    let expiredCount = 0;

    // Find expired bundles that aren't already in terminal state
    const expiredBundles = await query<EnfBundle>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enf_bundles
         WHERE expires_at < ? AND status NOT IN ('COMPLETE', 'EXPIRED', 'CANCELLED')`,
        [now]
    );

    for (const bundle of expiredBundles) {
        await execute(
            env.TATTLEHASH_DB,
            'UPDATE enf_bundles SET status = ?, updated_at = ? WHERE id = ?',
            ['EXPIRED', now, bundle.id]
        );

        // Expire all non-terminal recipients
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE enf_recipients SET status = 'EXPIRED', updated_at = ?
             WHERE enf_id = ? AND status IN ('PENDING', 'SENT', 'DELIVERED')`,
            [now, bundle.id]
        );

        await logEnfEvent(env, {
            enf_id: bundle.id,
            event_type: 'EXPIRED',
            actor_type: 'SYSTEM',
            actor_identifier: 'expiration_check',
        });

        expiredCount++;
    }

    if (expiredCount > 0) {
        console.log(JSON.stringify({
            t: now,
            at: 'enf_expiration_check',
            expired_count: expiredCount,
        }));
    }

    return expiredCount;
}

// ============================================================================
// Helpers
// ============================================================================

function generateDeliveryToken(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return 'enf_' + Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
