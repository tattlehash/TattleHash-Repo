/**
 * Payment Handlers
 *
 * HTTP handlers for Stripe payment integration.
 */

import { ok, err, parseBody } from '../lib/http';
import { Env } from '../types';
import {
    CreateCheckoutSchema,
    createCheckoutSession,
    verifyWebhookSignature,
    processWebhookEvent,
    StripeEvent,
    STRIPE_PRODUCTS,
} from '../payments';

// ============================================================================
// POST /payments/create-checkout - Create Stripe Checkout Session
// ============================================================================

export async function postCreateCheckout(
    req: Request,
    env: Env
): Promise<Response> {
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'INVALID_JSON', { message: bodyResult.error });
    }

    const parseResult = CreateCheckoutSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'VALIDATION_ERROR', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    try {
        const result = await createCheckoutSession(env, parseResult.data);
        return ok(result);
    } catch (error) {
        console.error('Create checkout failed:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(500, 'CHECKOUT_FAILED', { message });
    }
}

// ============================================================================
// POST /webhooks/stripe - Stripe Webhook Handler
// ============================================================================

export async function postStripeWebhook(
    req: Request,
    env: Env
): Promise<Response> {
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET as string | undefined;
    if (!webhookSecret) {
        console.error('STRIPE_WEBHOOK_SECRET not configured');
        return err(500, 'WEBHOOK_NOT_CONFIGURED', {
            message: 'Webhook secret not configured',
        });
    }

    // Get the signature from headers
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
        return err(400, 'MISSING_SIGNATURE', {
            message: 'Missing Stripe signature header',
        });
    }

    // Read the raw body
    const payload = await req.text();

    // Verify signature
    const isValid = await verifyWebhookSignature(payload, signature, webhookSecret);
    if (!isValid) {
        console.error('Invalid Stripe webhook signature');
        return err(400, 'INVALID_SIGNATURE', {
            message: 'Invalid webhook signature',
        });
    }

    // Parse the event
    let event: StripeEvent;
    try {
        event = JSON.parse(payload) as StripeEvent;
    } catch {
        return err(400, 'INVALID_PAYLOAD', {
            message: 'Invalid JSON payload',
        });
    }

    // Process the event
    try {
        const result = await processWebhookEvent(env, event);

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'stripe_webhook_processed',
            event_id: event.id,
            event_type: event.type,
            processed: result.processed,
            message: result.message,
        }));

        // Always return 200 to acknowledge receipt
        return ok({
            received: true,
            event_type: event.type,
            processed: result.processed,
        });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to prevent retries for processing errors
        return ok({
            received: true,
            event_type: event.type,
            processed: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}

// ============================================================================
// GET /payments/products - List available products
// ============================================================================

export async function getProducts(
    _req: Request,
    _env: Env
): Promise<Response> {
    const products = Object.entries(STRIPE_PRODUCTS).map(([key, product]) => ({
        mode: key,
        name: product.name,
        description: product.description,
        price_cents: product.price_cents,
        price_display: `$${(product.price_cents / 100).toFixed(2)}`,
        credits: product.credits,
        type: product.type,
    }));

    return ok({ products });
}

// ============================================================================
// GET /payments/success - Payment success page
// ============================================================================

export async function getPaymentSuccess(
    req: Request,
    _env: Env
): Promise<Response> {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Payment Successful - TattleHash</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .card {
            background: white;
            padding: 48px;
            border-radius: 16px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
        }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #2e7d32; margin: 0 0 8px; }
        p { color: #666; margin: 0 0 24px; }
        .session-id { font-size: 12px; color: #999; font-family: monospace; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10003;</div>
        <h1>Payment Successful!</h1>
        <p>Your credits have been added to your account.</p>
        ${sessionId ? `<div class="session-id">Session: ${sessionId.slice(0, 20)}...</div>` : ''}
    </div>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
    });
}

// ============================================================================
// GET /payments/cancel - Payment cancelled page
// ============================================================================

export async function getPaymentCancel(
    _req: Request,
    _env: Env
): Promise<Response> {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Payment Cancelled - TattleHash</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .card {
            background: white;
            padding: 48px;
            border-radius: 16px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
        }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { color: #856404; margin: 0 0 8px; }
        p { color: #666; margin: 0; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10007;</div>
        <h1>Payment Cancelled</h1>
        <p>Your payment was cancelled. No charges were made.</p>
    </div>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
    });
}
