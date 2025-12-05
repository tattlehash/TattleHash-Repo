/**
 * Stripe Payment Service
 *
 * Handles Stripe Checkout sessions and webhook processing.
 */

import { Env } from '../types';
import {
    STRIPE_PRODUCTS,
    ProductMode,
    CreateCheckoutInput,
    CheckoutResponse,
    StripeCheckoutSession,
    StripeEvent,
} from './types';
import { grantCredits } from '../credits/core';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// ============================================================================
// Stripe API Helpers
// ============================================================================

async function stripeRequest<T>(
    env: Env,
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
): Promise<T> {
    const secretKey = env.STRIPE_SECRET_KEY as string | undefined;
    if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY not configured');
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    const options: RequestInit = {
        method,
        headers,
    };

    if (body && method !== 'GET') {
        options.body = encodeFormData(body);
    }

    const response = await fetch(`${STRIPE_API_BASE}${endpoint}`, options);
    const data = await response.json() as T & { error?: { message: string } };

    if (!response.ok) {
        throw new Error(`Stripe API error: ${data.error?.message || response.statusText}`);
    }

    return data;
}

function encodeFormData(obj: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}[${key}]` : key;

        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            parts.push(encodeFormData(value as Record<string, unknown>, fullKey));
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => {
                if (typeof item === 'object') {
                    parts.push(encodeFormData(item as Record<string, unknown>, `${fullKey}[${index}]`));
                } else {
                    parts.push(`${encodeURIComponent(`${fullKey}[${index}]`)}=${encodeURIComponent(String(item))}`);
                }
            });
        } else {
            parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
        }
    }

    return parts.filter(p => p).join('&');
}

// ============================================================================
// Checkout Session Creation
// ============================================================================

export async function createCheckoutSession(
    env: Env,
    input: CreateCheckoutInput
): Promise<CheckoutResponse> {
    const product = STRIPE_PRODUCTS[input.mode];
    if (!product) {
        throw new Error(`Invalid product mode: ${input.mode}`);
    }

    const baseUrl = 'https://tattlehash-worker.ashiscock.workers.dev';
    const successUrl = input.success_url || `${baseUrl}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = input.cancel_url || `${baseUrl}/payments/cancel`;

    const quantity = input.quantity || 1;
    const totalCredits = product.credits * quantity;

    const sessionParams: Record<string, unknown> = {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            user_id: input.user_id,
            product_mode: input.mode,
            credits: String(totalCredits),
            quantity: String(quantity),
        },
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: quantity > 1 ? `${product.name} (x${quantity})` : product.name,
                        description: product.description,
                    },
                    unit_amount: product.price_cents,
                },
                quantity: quantity,
            },
        ],
    };

    const session = await stripeRequest<StripeCheckoutSession>(
        env,
        'POST',
        '/checkout/sessions',
        sessionParams
    );

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'checkout_session_created',
        session_id: session.id,
        user_id: input.user_id,
        product_mode: input.mode,
        amount_cents: product.price_cents,
    }));

    return {
        checkout_url: session.url!,
        session_id: session.id,
        product: {
            mode: input.mode,
            name: product.name,
            price_cents: product.price_cents,
            credits: product.credits,
        },
    };
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

export async function verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
): Promise<boolean> {
    // Parse the signature header
    const elements = signature.split(',');
    const sigData: Record<string, string> = {};

    for (const element of elements) {
        const [key, value] = element.split('=');
        sigData[key] = value;
    }

    const timestamp = sigData['t'];
    const v1Signature = sigData['v1'];

    if (!timestamp || !v1Signature) {
        return false;
    }

    // Check timestamp (allow 5 minutes tolerance)
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > 300) {
        console.log('Webhook signature timestamp too old');
        return false;
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(signedPayload)
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return expectedSignature === v1Signature;
}

// ============================================================================
// Webhook Event Processing
// ============================================================================

export async function processWebhookEvent(
    env: Env,
    event: StripeEvent
): Promise<{ processed: boolean; message: string }> {
    console.log(JSON.stringify({
        t: Date.now(),
        at: 'stripe_webhook_received',
        event_id: event.id,
        event_type: event.type,
    }));

    switch (event.type) {
        case 'checkout.session.completed':
            return handleCheckoutCompleted(env, event.data.object as StripeCheckoutSession);

        case 'payment_intent.succeeded':
            // Log but don't process - we handle credits on checkout.session.completed
            return { processed: true, message: 'Payment intent logged' };

        default:
            return { processed: false, message: `Unhandled event type: ${event.type}` };
    }
}

async function handleCheckoutCompleted(
    env: Env,
    session: StripeCheckoutSession
): Promise<{ processed: boolean; message: string }> {
    // Verify payment was successful
    if (session.payment_status !== 'paid') {
        return { processed: false, message: 'Payment not completed' };
    }

    const userId = session.metadata?.user_id;
    const productMode = session.metadata?.product_mode as ProductMode | undefined;
    const creditsStr = session.metadata?.credits;

    if (!userId || !productMode) {
        console.error('Missing metadata in checkout session', { session_id: session.id });
        return { processed: false, message: 'Missing user_id or product_mode in metadata' };
    }

    const credits = parseInt(creditsStr || '0', 10) || STRIPE_PRODUCTS[productMode]?.credits || 1;

    // Grant credits to the user
    try {
        await grantCredits(env, {
            userId,
            creditType: 'PROMO', // Using PROMO type for purchased credits
            amount: credits,
            sourceType: 'ADMIN', // Could add 'PURCHASE' type later
            sourceId: session.id,
            description: `Purchase: ${STRIPE_PRODUCTS[productMode]?.name || productMode} (${credits} credit${credits > 1 ? 's' : ''})`,
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year expiry
        });

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'credits_granted_from_purchase',
            user_id: userId,
            credits,
            product_mode: productMode,
            session_id: session.id,
            amount_cents: session.amount_total,
        }));

        // Store payment record for reference
        await env.TATTLEHASH_KV.put(
            `payment:${session.id}`,
            JSON.stringify({
                session_id: session.id,
                user_id: userId,
                product_mode: productMode,
                credits_granted: credits,
                amount_cents: session.amount_total,
                currency: session.currency,
                processed_at: Date.now(),
            }),
            { expirationTtl: 365 * 24 * 60 * 60 } // 1 year
        );

        return { processed: true, message: `Granted ${credits} credits to user ${userId}` };
    } catch (error) {
        console.error('Failed to grant credits:', error);
        return { processed: false, message: `Failed to grant credits: ${error}` };
    }
}

// ============================================================================
// Webhook Registration (one-time setup)
// ============================================================================

export async function registerWebhookEndpoint(
    env: Env,
    url: string,
    events: string[]
): Promise<{ webhook_id: string; secret: string }> {
    const response = await stripeRequest<{ id: string; secret: string }>(
        env,
        'POST',
        '/webhook_endpoints',
        {
            url,
            enabled_events: events,
            api_version: '2023-10-16',
        }
    );

    return {
        webhook_id: response.id,
        secret: response.secret,
    };
}
