/**
 * Stripe Payment Types and Constants
 */

import { z } from 'zod';

// ============================================================================
// Product Configuration
// ============================================================================

export const STRIPE_PRODUCTS = {
    SOLO: {
        mode: 'SOLO' as const,
        name: 'Solo Mode',
        description: 'Single attestation with blockchain anchoring',
        price_cents: 99, // $0.99
        credits: 1,
    },
    FIRE: {
        mode: 'FIRE' as const,
        name: 'Fire Mode',
        description: 'Fast-track attestation with priority processing',
        price_cents: 199, // $1.99
        credits: 1,
    },
    GATEKEEPER: {
        mode: 'GATEKEEPER' as const,
        name: 'Gatekeeper Mode',
        description: 'Two-party attestation with challenge support',
        price_cents: 199, // $1.99
        credits: 1,
    },
    ENFORCED: {
        mode: 'ENFORCED' as const,
        name: 'Enforced Mode',
        description: 'Full enforcement with stake requirements',
        price_cents: 299, // $2.99
        credits: 1,
    },
} as const;

export type ProductMode = keyof typeof STRIPE_PRODUCTS;

// ============================================================================
// Request Schemas
// ============================================================================

// Beta limits
export const PAYMENT_BETA_LIMITS = {
    MAX_CREDITS_PER_PURCHASE: 25,
} as const;

export const CreateCheckoutSchema = z.object({
    mode: z.enum(['SOLO', 'FIRE', 'GATEKEEPER', 'ENFORCED']),
    user_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(PAYMENT_BETA_LIMITS.MAX_CREDITS_PER_PURCHASE).default(1),
    success_url: z.string().url().optional(),
    cancel_url: z.string().url().optional(),
});

export type CreateCheckoutInput = z.infer<typeof CreateCheckoutSchema>;

// ============================================================================
// Stripe Types (minimal for our use case)
// ============================================================================

export interface StripeCheckoutSession {
    id: string;
    object: 'checkout.session';
    url: string | null;
    payment_status: 'paid' | 'unpaid' | 'no_payment_required';
    status: 'open' | 'complete' | 'expired';
    mode: 'payment' | 'subscription' | 'setup';
    customer: string | null;
    customer_email: string | null;
    metadata: Record<string, string>;
    amount_total: number | null;
    currency: string | null;
}

export interface StripeEvent {
    id: string;
    object: 'event';
    type: string;
    data: {
        object: StripeCheckoutSession | Record<string, unknown>;
    };
    created: number;
    livemode: boolean;
}

export interface StripeWebhookEndpoint {
    id: string;
    object: 'webhook_endpoint';
    url: string;
    enabled_events: string[];
    status: 'enabled' | 'disabled';
    secret?: string;
}

// ============================================================================
// Response Types
// ============================================================================

export interface CheckoutResponse {
    checkout_url: string;
    session_id: string;
    product: {
        mode: string;
        name: string;
        price_cents: number;
        credits: number;
    };
}

export interface WebhookResponse {
    received: boolean;
    event_type?: string;
    processed?: boolean;
}
