/**
 * ENF (Evidence-and-Forward) HTTP Handlers
 *
 * CRUD and action endpoints for evidence bundling with
 * multi-party acknowledgment and cryptographic signatures.
 */

import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { getFlag } from '../lib/flags';
import { authenticateRequest } from '../middleware/auth';
import { Env } from '../types';
import {
    CreateEnfBundleSchema,
    AcknowledgeEnfSchema,
    DeclineEnfSchema,
    SendEnfBundleSchema,
    CancelEnfBundleSchema,
} from '../enf/types';
import {
    createEnfBundle,
    getEnfBundle,
    listEnfBundles,
    getRecipientsByBundle,
    getRecipientByToken,
    sendEnfBundle,
    cancelEnfBundle,
    updateRecipientStatus,
} from '../enf/core';
import { getEventsByBundle, exportBundleAuditTrail } from '../enf/events';
import { processSignedAcknowledgment, getSignatureByRecipient } from '../enf/signatures';
import { emitEvent } from '../relay/events';

// ============================================================================
// POST /enf/init - Create ENF Bundle (Legacy endpoint, still supported)
// ============================================================================

export async function postEnfInit(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json() as Record<string, unknown>;

        // Support legacy format { data, counterparty } or new format
        const input = body.recipients
            ? CreateEnfBundleSchema.parse(body)
            : CreateEnfBundleSchema.parse({
                title: (body.title as string) || 'Evidence Bundle',
                evidence: (body.data || body.evidence || {}) as Record<string, unknown>,
                recipients: [{
                    type: (body.counterpartyType as string) || 'EMAIL',
                    identifier: body.counterparty as string,
                }],
                expiry_ms: body.expiryMs as number | undefined,
            });

        const { bundle, recipients } = await createEnfBundle(env, userId, input);

        // Emit webhook event
        await emitEvent(env, {
            type: 'enf.created',
            enf_id: bundle.id,
            initiator: userId,
            recipient_count: recipients.length,
        });

        return ok({
            id: bundle.id,
            title: bundle.title,
            status: bundle.status,
            evidence_hash: bundle.evidence_hash,
            recipients: recipients.map(r => ({
                id: r.id,
                type: r.counterparty_type,
                identifier: r.counterparty_identifier,
                status: r.status,
            })),
            expires_at: new Date(bundle.expires_at).toISOString(),
            created_at: new Date(bundle.created_at).toISOString(),
        }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF init error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/bundles - Create ENF Bundle (New endpoint)
// ============================================================================

export async function postCreateEnfBundle(
    request: Request,
    env: Env
): Promise<Response> {
    return postEnfInit(request, env);
}

// ============================================================================
// GET /enf/bundles - List My ENF Bundles
// ============================================================================

export async function getListEnfBundles(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const status = url.searchParams.get('status') as any;

        const bundles = await listEnfBundles(env, userId, { limit, offset, status });

        return ok({
            bundles: bundles.map(b => ({
                id: b.id,
                title: b.title,
                status: b.status,
                evidence_hash: b.evidence_hash,
                expires_at: new Date(b.expires_at).toISOString(),
                created_at: new Date(b.created_at).toISOString(),
            })),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF list error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enf/bundles/:id - Get ENF Bundle Details
// ============================================================================

export async function getEnfBundleDetails(
    request: Request,
    env: Env,
    bundleId: string
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const bundle = await getEnfBundle(env, bundleId, userId);
        if (!bundle) {
            return err(404, 'ENF_NOT_FOUND');
        }

        const recipients = await getRecipientsByBundle(env, bundleId);

        return ok({
            id: bundle.id,
            title: bundle.title,
            description: bundle.description,
            status: bundle.status,
            evidence_hash: bundle.evidence_hash,
            evidence: JSON.parse(bundle.evidence_payload),
            recipients: recipients.map(r => ({
                id: r.id,
                type: r.counterparty_type,
                identifier: r.counterparty_identifier,
                status: r.status,
                delivery_link: r.delivery_link,
                sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
                responded_at: r.responded_at ? new Date(r.responded_at).toISOString() : null,
                response_message: r.response_message,
            })),
            expires_at: new Date(bundle.expires_at).toISOString(),
            created_at: new Date(bundle.created_at).toISOString(),
            updated_at: new Date(bundle.updated_at).toISOString(),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF get error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/bundles/:id/send - Send Bundle to Recipients
// ============================================================================

export async function postSendEnfBundle(
    request: Request,
    env: Env,
    bundleId: string
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        // Get base URL for delivery links
        const url = new URL(request.url);
        const baseUrl = `${url.protocol}//${url.host}`;

        const { sent_count, recipients } = await sendEnfBundle(env, bundleId, userId, baseUrl);

        // Emit webhook event
        await emitEvent(env, {
            type: 'enf.sent',
            enf_id: bundleId,
            sent_count,
        });

        return ok({
            sent: true,
            sent_count,
            recipients: recipients.map(r => ({
                id: r.id,
                type: r.counterparty_type,
                identifier: r.counterparty_identifier,
                status: r.status,
                delivery_link: r.delivery_link,
            })),
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF send error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/bundles/:id/cancel - Cancel Bundle
// ============================================================================

export async function postCancelEnfBundle(
    request: Request,
    env: Env,
    bundleId: string
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        const body = await request.json().catch(() => ({}));
        const input = CancelEnfBundleSchema.parse(body);

        await cancelEnfBundle(env, bundleId, userId, input.reason);

        // Emit webhook event
        await emitEvent(env, {
            type: 'enf.cancelled',
            enf_id: bundleId,
            reason: input.reason,
        });

        return ok({ cancelled: true });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF cancel error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enf/bundles/:id/audit - Get Audit Trail
// ============================================================================

export async function getEnfAuditTrail(
    request: Request,
    env: Env,
    bundleId: string
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    const authResult = await authenticateRequest(request, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const { userId } = authResult.context;

    try {
        // Verify ownership
        const bundle = await getEnfBundle(env, bundleId, userId);
        if (!bundle) {
            return err(404, 'ENF_NOT_FOUND');
        }

        const audit = await exportBundleAuditTrail(env, bundleId);

        return ok(audit);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF audit error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// GET /enf/view/:token - View Evidence (Public endpoint for recipients)
// ============================================================================

export async function getEnfView(
    request: Request,
    env: Env,
    token: string
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const recipient = await getRecipientByToken(env, token);
        if (!recipient) {
            return err(404, 'ENF_INVALID_TOKEN');
        }

        // Check if already responded
        if (recipient.status === 'ACKNOWLEDGED' || recipient.status === 'DECLINED') {
            return err(409, 'ENF_ALREADY_RESPONDED');
        }

        // Get bundle
        const bundle = await getEnfBundle(env, recipient.enf_id);
        if (!bundle) {
            return err(404, 'ENF_NOT_FOUND');
        }

        // Check expiration
        if (bundle.status === 'EXPIRED' || Date.now() > bundle.expires_at) {
            return err(410, 'ENF_EXPIRED');
        }

        // Check cancellation
        if (bundle.status === 'CANCELLED') {
            return err(410, 'ENF_CANCELLED');
        }

        // Mark as delivered if just sent
        if (recipient.status === 'SENT') {
            await updateRecipientStatus(
                env,
                recipient.id,
                'DELIVERED',
                'RECIPIENT',
                recipient.counterparty_identifier
            );
        }

        return ok({
            enf_id: bundle.id,
            recipient_id: recipient.id,
            title: bundle.title,
            description: bundle.description,
            evidence: JSON.parse(bundle.evidence_payload),
            evidence_hash: bundle.evidence_hash,
            expires_at: new Date(bundle.expires_at).toISOString(),
            created_at: new Date(bundle.created_at).toISOString(),
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF view error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/action - Acknowledge or Decline (Legacy endpoint)
// ============================================================================

export async function postEnfAction(
    request: Request,
    env: Env
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = await request.json() as Record<string, unknown>;

        // Support legacy format { id, action, signature } or new format { token, ... }
        if (body.action === 'sign' || body.action === 'acknowledge') {
            return postEnfAcknowledge(request, env, body);
        } else if (body.action === 'decline') {
            return postEnfDecline(request, env, body);
        }

        return err(400, 'VALIDATION_ERROR', { message: 'Unknown action' });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF action error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/acknowledge - Acknowledge Evidence
// ============================================================================

export async function postEnfAcknowledge(
    request: Request,
    env: Env,
    bodyOverride?: any
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = bodyOverride || await request.json();

        // Handle legacy format
        const token = body.token || body.id;
        const signatureType = body.signature_type || (body.signature ? 'EIP191' : 'CLICK_ACK');

        const input = AcknowledgeEnfSchema.parse({
            token,
            signature_type: signatureType,
            signature: body.signature,
            signer_address: body.signer_address || body.signerAddress,
            message: body.message,
        });

        const recipient = await getRecipientByToken(env, input.token);
        if (!recipient) {
            return err(404, 'ENF_INVALID_TOKEN');
        }

        // Check if already responded
        if (recipient.status === 'ACKNOWLEDGED' || recipient.status === 'DECLINED') {
            return err(409, 'ENF_ALREADY_RESPONDED');
        }

        // Get bundle for validation
        const bundle = await getEnfBundle(env, recipient.enf_id);
        if (!bundle) {
            return err(404, 'ENF_NOT_FOUND');
        }

        if (bundle.status === 'EXPIRED' || Date.now() > bundle.expires_at) {
            return err(410, 'ENF_EXPIRED');
        }

        if (bundle.status === 'CANCELLED') {
            return err(410, 'ENF_CANCELLED');
        }

        // Require signature for EIP191
        if (input.signature_type === 'EIP191' && (!input.signature || !input.signer_address)) {
            return err(400, 'ENF_SIGNATURE_REQUIRED');
        }

        // Process signature
        const now = Date.now();
        const signatureResult = await processSignedAcknowledgment(env, {
            recipientId: recipient.id,
            enfId: bundle.id,
            evidenceHash: bundle.evidence_hash,
            signatureType: input.signature_type,
            signature: input.signature,
            signerAddress: input.signer_address,
            timestamp: now,
        });

        // Update recipient status
        await updateRecipientStatus(
            env,
            recipient.id,
            'ACKNOWLEDGED',
            'RECIPIENT',
            recipient.counterparty_identifier,
            { response_message: input.message }
        );

        // Emit webhook event
        await emitEvent(env, {
            type: 'enf.acknowledged',
            enf_id: bundle.id,
            recipient_id: recipient.id,
            signature_verified: signatureResult.verified,
        });

        return ok({
            acknowledged: true,
            enf_id: bundle.id,
            recipient_id: recipient.id,
            signature_verified: signatureResult.verified,
            evidence_hash: bundle.evidence_hash,
            message_hash: signatureResult.message_hash,
            acknowledged_at: new Date(now).toISOString(),
        });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF acknowledge error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

// ============================================================================
// POST /enf/decline - Decline Evidence
// ============================================================================

export async function postEnfDecline(
    request: Request,
    env: Env,
    bodyOverride?: any
): Promise<Response> {
    if (!getFlag('ENF_ENABLED', env)) {
        return err(503, 'FEATURE_DISABLED');
    }

    try {
        const body = bodyOverride || await request.json();

        // Handle legacy format
        const token = body.token || body.id;

        const input = DeclineEnfSchema.parse({
            token,
            reason: body.reason,
        });

        const recipient = await getRecipientByToken(env, input.token);
        if (!recipient) {
            return err(404, 'ENF_INVALID_TOKEN');
        }

        // Check if already responded
        if (recipient.status === 'ACKNOWLEDGED' || recipient.status === 'DECLINED') {
            return err(409, 'ENF_ALREADY_RESPONDED');
        }

        // Get bundle for validation
        const bundle = await getEnfBundle(env, recipient.enf_id);
        if (!bundle) {
            return err(404, 'ENF_NOT_FOUND');
        }

        if (bundle.status === 'EXPIRED' || Date.now() > bundle.expires_at) {
            return err(410, 'ENF_EXPIRED');
        }

        if (bundle.status === 'CANCELLED') {
            return err(410, 'ENF_CANCELLED');
        }

        // Update recipient status
        await updateRecipientStatus(
            env,
            recipient.id,
            'DECLINED',
            'RECIPIENT',
            recipient.counterparty_identifier,
            { response_message: input.reason }
        );

        // Emit webhook event
        await emitEvent(env, {
            type: 'enf.declined',
            enf_id: bundle.id,
            recipient_id: recipient.id,
            reason: input.reason,
        });

        return ok({
            declined: true,
            enf_id: bundle.id,
            recipient_id: recipient.id,
            declined_at: new Date().toISOString(),
        });
    } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ZodError') {
            return err(400, 'VALIDATION_ERROR', { errors: (e as any).errors });
        }
        if (e && typeof e === 'object' && 'code' in e) {
            return err((e as any).status || 400, (e as any).code, (e as any).details);
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('ENF decline error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
