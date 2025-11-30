/**
 * Webhook Management HTTP Handlers
 *
 * CRUD endpoints for webhook subscriptions and delivery history.
 */

import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { getFlag } from '../lib/flags';
import { authenticateRequest } from '../middleware/auth';
import { Env } from '../types';
import {
    createSubscription,
    getSubscription,
    listSubscriptions,
    updateSubscription,
    deleteSubscription,
    rotateSecret,
    getDeliveryHistory,
    EVENT_TYPES,
} from '../relay';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

const CreateWebhookSchema = z.object({
    url: z.string().url(),
    events: z.array(z.string()).min(1),
    description: z.string().max(200).optional(),
});

const UpdateWebhookSchema = z.object({
    url: z.string().url().optional(),
    events: z.array(z.string()).min(1).optional(),
    description: z.string().max(200).optional(),
    active: z.boolean().optional(),
});

// ============================================================================
// POST /webhooks - Create Subscription
// ============================================================================

export async function postCreateWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = CreateWebhookSchema.parse(body);

        const subscription = await createSubscription(env, userId, {
            url: data.url,
            events: data.events as any,
            description: data.description,
        });

        return ok({
            id: subscription.id,
            url: subscription.url,
            events: subscription.events,
            description: subscription.description,
            active: subscription.active,
            secret: subscription.secret, // Only shown once on creation
            created_at: new Date(subscription.created_at).toISOString(),
        }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Create webhook error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /webhooks - List Subscriptions
// ============================================================================

export async function getListWebhooks(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const subscriptions = await listSubscriptions(env, userId);

        return ok({
            webhooks: subscriptions.map(sub => ({
                id: sub.id,
                url: sub.url,
                events: sub.events,
                description: sub.description,
                active: sub.active,
                created_at: new Date(sub.created_at).toISOString(),
            })),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('List webhooks error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /webhooks/:id - Get Subscription
// ============================================================================

export async function getWebhook(
    request: Request,
    env: Env,
    webhookId: string
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const subscription = await getSubscription(env, webhookId, userId);
        if (!subscription) {
            return err(404, 'NOT_FOUND');
        }

        return ok({
            id: subscription.id,
            url: subscription.url,
            events: subscription.events,
            description: subscription.description,
            active: subscription.active,
            created_at: new Date(subscription.created_at).toISOString(),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get webhook error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// PATCH /webhooks/:id - Update Subscription
// ============================================================================

export async function patchWebhook(
    request: Request,
    env: Env,
    webhookId: string
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json();
        const data = UpdateWebhookSchema.parse(body);

        const subscription = await updateSubscription(env, webhookId, userId, {
            url: data.url,
            events: data.events as any,
            description: data.description,
            active: data.active,
        });

        return ok({
            id: subscription.id,
            url: subscription.url,
            events: subscription.events,
            description: subscription.description,
            active: subscription.active,
            created_at: new Date(subscription.created_at).toISOString(),
        });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Update webhook error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// DELETE /webhooks/:id - Delete Subscription
// ============================================================================

export async function deleteWebhookHandler(
    request: Request,
    env: Env,
    webhookId: string
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        await deleteSubscription(env, webhookId, userId);
        return ok({ deleted: true });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Delete webhook error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /webhooks/:id/rotate-secret - Rotate Secret
// ============================================================================

export async function postRotateSecret(
    request: Request,
    env: Env,
    webhookId: string
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const result = await rotateSecret(env, webhookId, userId);
        return ok({ secret: result.secret });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Rotate secret error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /webhooks/:id/deliveries - Get Delivery History
// ============================================================================

export async function getWebhookDeliveries(
    request: Request,
    env: Env,
    webhookId: string
): Promise<Response> {
    if (!getFlag('WEBHOOKS_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        // Verify ownership
        const subscription = await getSubscription(env, webhookId, userId);
        if (!subscription) {
            return err(404, 'NOT_FOUND');
        }

        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

        const deliveries = await getDeliveryHistory(env, webhookId, limit);

        return ok({
            deliveries: deliveries.map(d => ({
                id: d.id,
                event_type: d.event_type,
                status: d.status,
                attempts: d.attempts,
                last_attempt_at: d.last_attempt_at
                    ? new Date(d.last_attempt_at).toISOString()
                    : null,
                delivered_at: d.delivered_at
                    ? new Date(d.delivered_at).toISOString()
                    : null,
                created_at: new Date(d.created_at).toISOString(),
            })),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get deliveries error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /webhooks/events - List Available Event Types
// ============================================================================

export async function getWebhookEvents(
    request: Request,
    env: Env
): Promise<Response> {
    return ok({
        events: Object.entries(EVENT_TYPES).map(([type, description]) => ({
            type,
            description,
        })),
    });
}
