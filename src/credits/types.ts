/**
 * Credits & Loyalty System Types and Schemas
 *
 * Zod schemas for validation and constants for the credit system.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const CREDIT_DEFAULTS = {
    // Expiration periods (in milliseconds)
    PROMO_EXPIRY_MS: 14 * 24 * 60 * 60 * 1000, // 14 days
    REFERRAL_REWARD_EXPIRY_MS: 90 * 24 * 60 * 60 * 1000, // 90 days
    LOYALTY_CREDIT_EXPIRY_MS: 365 * 24 * 60 * 60 * 1000, // 1 year
    REFERRAL_COUPON_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000, // 30 days

    // Initial credits
    REFERRAL_SIGNUP_CREDITS: 2, // Promo credits for new user via referral
    REFERRAL_REWARD_CREDITS: 1, // Credits for referrer when referral converts
    FIRST_TRANSACTION_COUPONS: 2, // Referral coupons after first paid transaction

    // Limits
    MAX_REFERRAL_COUPONS_PER_MONTH: 10,
    MAX_CREDITS_PER_HOLD: 10,
    HOLD_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours
};

export const LOYALTY_TIERS = {
    BRONZE: {
        tier: 'BRONZE' as const,
        display_name: 'Bronze',
        min_transactions: 0,
        credit_back_percent: 0,
    },
    SILVER: {
        tier: 'SILVER' as const,
        display_name: 'Silver',
        min_transactions: 25,
        credit_back_percent: 0.02, // 2%
    },
    GOLD: {
        tier: 'GOLD' as const,
        display_name: 'Gold',
        min_transactions: 100,
        credit_back_percent: 0.05, // 5%
    },
    PLATINUM: {
        tier: 'PLATINUM' as const,
        display_name: 'Platinum',
        min_transactions: 500,
        credit_back_percent: 0.10, // 10%
    },
} as const;

export const MILESTONES = [
    { transaction_count: 25, credits: 2 },
    { transaction_count: 50, credits: 3 },
    { transaction_count: 100, credits: 5 },
    { transaction_count: 250, credits: 10 },
    { transaction_count: 500, credits: 20 },
    { transaction_count: 1000, credits: 50 },
] as const;

// ============================================================================
// Zod Schemas
// ============================================================================

export const LoyaltyTierSchema = z.enum(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

export const CreditTypeSchema = z.enum(['REFERRAL_REWARD', 'PROMO', 'MILESTONE', 'LOYALTY']);

export const CreditSourceTypeSchema = z.enum([
    'REFERRAL',
    'PROMO_CODE',
    'MILESTONE',
    'LOYALTY_CASHBACK',
    'ADMIN',
]);

export const CreditBalanceStatusSchema = z.enum(['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED']);

export const CreditEventTypeSchema = z.enum([
    'GRANT',
    'REDEEM',
    'EXPIRE',
    'CANCEL',
    'REFUND',
    'HOLD',
    'RELEASE',
]);

export const PromotionStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED']);

export const ReferralCouponStatusSchema = z.enum(['PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED']);

export const CreditHoldStatusSchema = z.enum(['HELD', 'RELEASED', 'APPLIED', 'EXPIRED']);

// ============================================================================
// Request Schemas
// ============================================================================

export const GetCreditsSchema = z.object({
    include_history: z.boolean().optional().default(false),
    history_limit: z.number().min(1).max(100).optional().default(20),
});

export const RedeemCreditsSchema = z.object({
    amount: z.number().int().min(1).max(10),
    transaction_id: z.string().min(1).optional(),
    challenge_id: z.string().min(1).optional(),
});

export const SendReferralSchema = z.object({
    recipient_email: z.string().email().optional(),
});

export const ClaimReferralSchema = z.object({
    coupon_code: z.string().min(6).max(20),
});

export const ClaimPromotionSchema = z.object({
    promo_code: z.string().min(3).max(50),
});

export const CreatePromotionSchema = z.object({
    code: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/i, 'Code must be alphanumeric'),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    credits_granted: z.number().int().min(1).max(100),
    expiry_days: z.number().int().min(1).max(365).optional().default(14),
    max_claims: z.number().int().min(1).optional(),
    max_claims_per_user: z.number().int().min(1).max(10).optional().default(1),
    new_users_only: z.boolean().optional().default(false),
    min_tier: LoyaltyTierSchema.optional(),
    starts_at: z.number().int().optional(),
    ends_at: z.number().int().optional(),
});

export const UpdatePromotionSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    max_claims: z.number().int().min(1).optional(),
    status: PromotionStatusSchema.optional(),
    ends_at: z.number().int().optional(),
});

// ============================================================================
// Response Types
// ============================================================================

export interface CreditSummary {
    total_available: number;
    total_pending: number;
    loyalty_tier: string;
    tier_display_name: string;
    tier_credit_back_percent: number;
    lifetime_transactions: number;
    lifetime_credits_earned: number;
    lifetime_credits_used: number;
    next_tier?: {
        tier: string;
        transactions_needed: number;
    };
    referral_code?: string;
    referral_coupons_available: number;
    referral_conversions: number;
    expiring_soon: {
        amount: number;
        expires_at: number;
    }[];
}

export interface CreditHistoryItem {
    event_type: string;
    amount: number;
    description: string;
    balance_after: number;
    created_at: number;
}

export interface ReferralStatus {
    referral_code: string;
    coupons_available: number;
    coupons_sent: number;
    conversions: number;
    pending_referrals: Array<{
        coupon_code: string;
        recipient_email?: string;
        status: string;
        created_at: number;
        expires_at: number;
    }>;
}

// ============================================================================
// Type Exports
// ============================================================================

export type LoyaltyTier = z.infer<typeof LoyaltyTierSchema>;
export type CreditType = z.infer<typeof CreditTypeSchema>;
export type CreditSourceType = z.infer<typeof CreditSourceTypeSchema>;
export type CreditBalanceStatus = z.infer<typeof CreditBalanceStatusSchema>;
export type CreditEventType = z.infer<typeof CreditEventTypeSchema>;
export type PromotionStatus = z.infer<typeof PromotionStatusSchema>;
export type ReferralCouponStatus = z.infer<typeof ReferralCouponStatusSchema>;
export type CreditHoldStatus = z.infer<typeof CreditHoldStatusSchema>;

export type GetCreditsInput = z.infer<typeof GetCreditsSchema>;
export type RedeemCreditsInput = z.infer<typeof RedeemCreditsSchema>;
export type SendReferralInput = z.infer<typeof SendReferralSchema>;
export type ClaimReferralInput = z.infer<typeof ClaimReferralSchema>;
export type ClaimPromotionInput = z.infer<typeof ClaimPromotionSchema>;
export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof UpdatePromotionSchema>;
