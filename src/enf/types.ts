/**
 * ENF (Evidence-and-Forward) Types and Schemas
 *
 * Zod validation schemas for ENF operations.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const ENF_DEFAULTS = {
    /** Default expiry: 7 days in milliseconds */
    DEFAULT_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    /** Minimum expiry: 1 hour */
    MIN_EXPIRY_MS: 60 * 60 * 1000,
    /** Maximum expiry: 30 days */
    MAX_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000,
    /** Maximum evidence payload size: 1MB */
    MAX_EVIDENCE_SIZE: 1024 * 1024,
    /** Maximum recipients per bundle */
    MAX_RECIPIENTS: 10,
} as const;

// ============================================================================
// Recipient Schema
// ============================================================================

export const RecipientInputSchema = z.object({
    type: z.enum(['EMAIL', 'WALLET', 'USER_ID']),
    identifier: z.string().min(1).max(256),
});

export type RecipientInput = z.infer<typeof RecipientInputSchema>;

// ============================================================================
// Create Bundle Schema
// ============================================================================

export const CreateEnfBundleSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    evidence: z.record(z.string(), z.unknown()),
    recipients: z.array(RecipientInputSchema).min(1).max(ENF_DEFAULTS.MAX_RECIPIENTS),
    expiry_ms: z.number()
        .int()
        .min(ENF_DEFAULTS.MIN_EXPIRY_MS)
        .max(ENF_DEFAULTS.MAX_EXPIRY_MS)
        .optional(),
    initiator_wallet: z.string().optional(),
});

export type CreateEnfBundleInput = z.infer<typeof CreateEnfBundleSchema>;

// ============================================================================
// Acknowledge/Sign Schema
// ============================================================================

export const AcknowledgeEnfSchema = z.object({
    /** Delivery token from the action link */
    token: z.string().min(1),
    /** Signature type */
    signature_type: z.enum(['EIP191', 'EIP712', 'CLICK_ACK']),
    /** EIP-191/712 signature (hex) */
    signature: z.string().optional(),
    /** Signer wallet address for verification */
    signer_address: z.string().optional(),
    /** Optional response message */
    message: z.string().max(1000).optional(),
});

export type AcknowledgeEnfInput = z.infer<typeof AcknowledgeEnfSchema>;

// ============================================================================
// Decline Schema
// ============================================================================

export const DeclineEnfSchema = z.object({
    /** Delivery token from the action link */
    token: z.string().min(1),
    /** Optional reason for declining */
    reason: z.string().max(1000).optional(),
});

export type DeclineEnfInput = z.infer<typeof DeclineEnfSchema>;

// ============================================================================
// Send Bundle Schema (for delayed sending)
// ============================================================================

export const SendEnfBundleSchema = z.object({
    /** Optional custom delivery message */
    custom_message: z.string().max(500).optional(),
});

export type SendEnfBundleInput = z.infer<typeof SendEnfBundleSchema>;

// ============================================================================
// Cancel Schema
// ============================================================================

export const CancelEnfBundleSchema = z.object({
    /** Optional reason for cancellation */
    reason: z.string().max(500).optional(),
});

export type CancelEnfBundleInput = z.infer<typeof CancelEnfBundleSchema>;

// ============================================================================
// Bundle Response Types
// ============================================================================

export interface EnfBundleResponse {
    id: string;
    title: string;
    description?: string;
    status: string;
    evidence_hash: string;
    recipients: EnfRecipientResponse[];
    expires_at: string;
    created_at: string;
    updated_at: string;
}

export interface EnfRecipientResponse {
    id: string;
    type: string;
    identifier: string;
    status: string;
    delivery_link?: string;
    sent_at?: string;
    responded_at?: string;
}

export interface EnfAcknowledgmentResponse {
    success: boolean;
    enf_id: string;
    signature_verified: boolean;
    evidence_hash: string;
    acknowledged_at: string;
}

// ============================================================================
// EIP-191 Message Format
// ============================================================================

export function createEip191Message(
    enfId: string,
    evidenceHash: string,
    recipientId: string,
    timestamp: number
): string {
    return [
        'TattleHash Evidence Acknowledgment',
        '',
        `ENF ID: ${enfId}`,
        `Evidence Hash: ${evidenceHash}`,
        `Recipient ID: ${recipientId}`,
        `Timestamp: ${new Date(timestamp).toISOString()}`,
        '',
        'By signing this message, I acknowledge receipt of the above evidence.',
    ].join('\n');
}

// ============================================================================
// State Machine Transitions
// ============================================================================

export const BUNDLE_TRANSITIONS: Record<string, string[]> = {
    'DRAFT': ['SENT', 'CANCELLED'],
    'SENT': ['PARTIAL', 'COMPLETE', 'EXPIRED', 'CANCELLED'],
    'PARTIAL': ['COMPLETE', 'EXPIRED', 'CANCELLED'],
    'COMPLETE': [],
    'EXPIRED': [],
    'CANCELLED': [],
};

export const RECIPIENT_TRANSITIONS: Record<string, string[]> = {
    'PENDING': ['SENT', 'EXPIRED'],
    'SENT': ['DELIVERED', 'ACKNOWLEDGED', 'DECLINED', 'EXPIRED'],
    'DELIVERED': ['ACKNOWLEDGED', 'DECLINED', 'EXPIRED'],
    'ACKNOWLEDGED': [],
    'DECLINED': [],
    'EXPIRED': [],
};

export function canTransitionBundle(from: string, to: string): boolean {
    return BUNDLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionRecipient(from: string, to: string): boolean {
    return RECIPIENT_TRANSITIONS[from]?.includes(to) ?? false;
}
