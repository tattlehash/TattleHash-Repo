/**
 * Webhook Subscription Management
 *
 * CRUD operations for webhook subscriptions.
 * Each user can have multiple webhook endpoints.
 */

import { execute, query, queryOne } from '../db';
import { createError } from '../errors';
import { Env } from '../types';
import type { WebhookSubscription } from './types';

// ============================================================================
// Event Types
// ============================================================================

export const EVENT_TYPES = {
    // Challenge lifecycle
    'challenge.created': 'Challenge was created',
    'challenge.sent': 'Challenge was sent to counterparty',
    'challenge.accepted': 'Challenge was accepted by counterparty',
    'challenge.completed': 'Challenge was completed successfully',
    'challenge.cancelled': 'Challenge was cancelled',
    'challenge.expired': 'Challenge expired without completion',
    'challenge.disputed': 'Dispute was raised on challenge',
    'challenge.resolved': 'Dispute was resolved',

    // Gatekeeper events
    'gatekeeper.wallet_verified': 'Wallet ownership was verified',
    'gatekeeper.funds_checked': 'Funds verification completed',
    'gatekeeper.intent_locked': 'Intent was locked (both parties committed)',

    // Enforced mode events
    'enforced.stake_deposited': 'Stake was deposited',
    'enforced.stake_confirmed': 'Stake deposit was confirmed on-chain',
    'enforced.stake_released': 'Stake was released',
    'enforced.stake_slashed': 'Stake was slashed',
    'enforced.traffic_light_changed': 'Traffic light state changed',

    // Attestation events
    'attestation.created': 'Attestation was created',
    'attestation.anchored': 'Attestation was anchored to blockchain',

    // Game events
    'game.created': 'Fee-splitting game was created',
    'game.completed': 'Game was completed with winner',

    // ENF (Evidence-and-Forward) events
    'enf.created': 'ENF evidence bundle was created',
    'enf.sent': 'ENF bundle was sent to recipients',
    'enf.acknowledged': 'Recipient acknowledged ENF evidence',
    'enf.declined': 'Recipient declined ENF evidence',
    'enf.expired': 'ENF bundle expired without full response',
    'enf.cancelled': 'ENF bundle was cancelled by initiator',

    // LLM Monitoring events
    'monitoring.analysis_completed': 'LLM analysis was completed',
    'monitoring.high_risk_detected': 'High risk level detected',
    'monitoring.critical_flag_raised': 'Critical flag was raised',
    'monitoring.url_threat_detected': 'Malicious URL was detected',

    // Wildcard
    '*': 'All events',
} as const;

export type EventType = keyof typeof EVENT_TYPES;

// ============================================================================
// Subscription CRUD
// ============================================================================

export interface CreateSubscriptionInput {
    url: string;
    events: EventType[];
    description?: string;
}

export interface UpdateSubscriptionInput {
    url?: string;
    events?: EventType[];
    description?: string;
    active?: boolean;
}

export async function createSubscription(
    env: Env,
    userId: string,
    input: CreateSubscriptionInput
): Promise<WebhookSubscription> {
    // Validate URL
    try {
        const url = new URL(input.url);
        if (url.protocol !== 'https:') {
            throw createError('VALIDATION_ERROR', { message: 'Webhook URL must use HTTPS' });
        }
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e && (e as any).code === 'VALIDATION_ERROR') throw e;
        throw createError('VALIDATION_ERROR', { message: 'Invalid webhook URL' });
    }

    // Validate event types
    for (const event of input.events) {
        if (!(event in EVENT_TYPES)) {
            throw createError('VALIDATION_ERROR', {
                message: `Invalid event type: ${event}`,
                valid_events: Object.keys(EVENT_TYPES),
            });
        }
    }

    // Generate secure secret
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secret = 'whsec_' + Array.from(secretBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO webhooks (
            id, user_id, url, secret, events, description, created_at, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userId,
            input.url,
            secret,
            JSON.stringify(input.events),
            input.description ?? null,
            now,
            1, // active by default
        ]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'webhook_subscription_created',
        subscription_id: id,
        user_id: userId,
        events: input.events,
    }));

    return {
        id,
        user_id: userId,
        url: input.url,
        events: input.events,
        secret,
        active: true,
        created_at: now,
    };
}

export async function getSubscription(
    env: Env,
    subscriptionId: string,
    userId?: string
): Promise<WebhookSubscription | null> {
    const sql = userId
        ? 'SELECT * FROM webhooks WHERE id = ? AND user_id = ?'
        : 'SELECT * FROM webhooks WHERE id = ?';
    const params = userId ? [subscriptionId, userId] : [subscriptionId];

    const row = await queryOne<any>(env.TATTLEHASH_DB, sql, params);
    if (!row) return null;

    return {
        ...row,
        events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events,
        active: Boolean(row.active),
    };
}

export async function listSubscriptions(
    env: Env,
    userId: string
): Promise<WebhookSubscription[]> {
    const rows = await query<any>(
        env.TATTLEHASH_DB,
        'SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
    );

    return rows.map(row => ({
        ...row,
        events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events,
        active: Boolean(row.active),
    }));
}

export async function updateSubscription(
    env: Env,
    subscriptionId: string,
    userId: string,
    input: UpdateSubscriptionInput
): Promise<WebhookSubscription> {
    const existing = await getSubscription(env, subscriptionId, userId);
    if (!existing) {
        throw createError('NOT_FOUND', { resource: 'webhook_subscription' });
    }

    // Validate URL if provided
    if (input.url) {
        try {
            const url = new URL(input.url);
            if (url.protocol !== 'https:') {
                throw createError('VALIDATION_ERROR', { message: 'Webhook URL must use HTTPS' });
            }
        } catch (e: unknown) {
            if (e && typeof e === 'object' && 'code' in e && (e as any).code === 'VALIDATION_ERROR') throw e;
            throw createError('VALIDATION_ERROR', { message: 'Invalid webhook URL' });
        }
    }

    // Validate event types if provided
    if (input.events) {
        for (const event of input.events) {
            if (!(event in EVENT_TYPES)) {
                throw createError('VALIDATION_ERROR', {
                    message: `Invalid event type: ${event}`,
                    valid_events: Object.keys(EVENT_TYPES),
                });
            }
        }
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (input.url !== undefined) {
        updates.push('url = ?');
        params.push(input.url);
    }
    if (input.events !== undefined) {
        updates.push('events = ?');
        params.push(JSON.stringify(input.events));
    }
    if (input.description !== undefined) {
        updates.push('description = ?');
        params.push(input.description);
    }
    if (input.active !== undefined) {
        updates.push('active = ?');
        params.push(input.active ? 1 : 0);
    }

    if (updates.length === 0) {
        return existing;
    }

    params.push(subscriptionId);

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`,
        params
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_subscription_updated',
        subscription_id: subscriptionId,
        updates: Object.keys(input),
    }));

    return (await getSubscription(env, subscriptionId, userId))!;
}

export async function deleteSubscription(
    env: Env,
    subscriptionId: string,
    userId: string
): Promise<void> {
    const existing = await getSubscription(env, subscriptionId, userId);
    if (!existing) {
        throw createError('NOT_FOUND', { resource: 'webhook_subscription' });
    }

    await execute(
        env.TATTLEHASH_DB,
        'DELETE FROM webhooks WHERE id = ?',
        [subscriptionId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_subscription_deleted',
        subscription_id: subscriptionId,
        user_id: userId,
    }));
}

export async function rotateSecret(
    env: Env,
    subscriptionId: string,
    userId: string
): Promise<{ secret: string }> {
    const existing = await getSubscription(env, subscriptionId, userId);
    if (!existing) {
        throw createError('NOT_FOUND', { resource: 'webhook_subscription' });
    }

    // Generate new secret
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const newSecret = 'whsec_' + Array.from(secretBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    await execute(
        env.TATTLEHASH_DB,
        'UPDATE webhooks SET secret = ? WHERE id = ?',
        [newSecret, subscriptionId]
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'webhook_secret_rotated',
        subscription_id: subscriptionId,
        user_id: userId,
    }));

    return { secret: newSecret };
}

// ============================================================================
// Active Subscriptions for Event
// ============================================================================

export async function getActiveSubscriptionsForEvent(
    env: Env,
    eventType: string
): Promise<WebhookSubscription[]> {
    const rows = await query<any>(
        env.TATTLEHASH_DB,
        'SELECT * FROM webhooks WHERE active = 1',
        []
    );

    return rows
        .map(row => ({
            ...row,
            events: typeof row.events === 'string' ? JSON.parse(row.events) : row.events,
            active: Boolean(row.active),
        }))
        .filter(sub =>
            sub.events.includes(eventType) || sub.events.includes('*')
        );
}
