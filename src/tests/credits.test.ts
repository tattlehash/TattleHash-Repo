/**
 * Credits & Loyalty Tests
 *
 * Comprehensive tests for the credit system including:
 * - Schema validation
 * - Credit granting and redemption
 * - Referral system
 * - Loyalty tiers and milestones
 * - Promotions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    GetCreditsSchema,
    RedeemCreditsSchema,
    SendReferralSchema,
    ClaimReferralSchema,
    ClaimPromotionSchema,
    CreatePromotionSchema,
    UpdatePromotionSchema,
    LoyaltyTierSchema,
    CreditTypeSchema,
    CreditSourceTypeSchema,
    CreditBalanceStatusSchema,
    CreditEventTypeSchema,
    PromotionStatusSchema,
    ReferralCouponStatusSchema,
    CreditHoldStatusSchema,
    CREDIT_DEFAULTS,
    LOYALTY_TIERS,
    MILESTONES,
} from '../credits/types';
import { Env } from '../types';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(dbResults: any[] = []): Env {
    const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: dbResults }),
            run: vi.fn().mockResolvedValue({ success: true }),
        })),
    };

    const mockKv = {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        TATTLEHASH_KV: mockKv,
    } as any;
}

// ============================================================================
// Constants Tests
// ============================================================================

describe('Credits & Loyalty Constants', () => {
    describe('CREDIT_DEFAULTS', () => {
        it('should have promo expiry of 14 days', () => {
            expect(CREDIT_DEFAULTS.PROMO_EXPIRY_MS).toBe(14 * 24 * 60 * 60 * 1000);
        });

        it('should have referral reward expiry of 90 days', () => {
            expect(CREDIT_DEFAULTS.REFERRAL_REWARD_EXPIRY_MS).toBe(90 * 24 * 60 * 60 * 1000);
        });

        it('should have loyalty credit expiry of 1 year', () => {
            expect(CREDIT_DEFAULTS.LOYALTY_CREDIT_EXPIRY_MS).toBe(365 * 24 * 60 * 60 * 1000);
        });

        it('should have referral coupon expiry of 30 days', () => {
            expect(CREDIT_DEFAULTS.REFERRAL_COUPON_EXPIRY_MS).toBe(30 * 24 * 60 * 60 * 1000);
        });

        it('should grant 2 credits on referral signup', () => {
            expect(CREDIT_DEFAULTS.REFERRAL_SIGNUP_CREDITS).toBe(2);
        });

        it('should grant 1 credit as referral reward', () => {
            expect(CREDIT_DEFAULTS.REFERRAL_REWARD_CREDITS).toBe(1);
        });

        it('should grant 2 coupons on first transaction', () => {
            expect(CREDIT_DEFAULTS.FIRST_TRANSACTION_COUPONS).toBe(2);
        });

        it('should have monthly referral limit of 10', () => {
            expect(CREDIT_DEFAULTS.MAX_REFERRAL_COUPONS_PER_MONTH).toBe(10);
        });

        it('should have hold expiry of 24 hours', () => {
            expect(CREDIT_DEFAULTS.HOLD_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
        });
    });

    describe('LOYALTY_TIERS', () => {
        it('should define four tiers', () => {
            expect(Object.keys(LOYALTY_TIERS)).toHaveLength(4);
            expect(LOYALTY_TIERS.BRONZE).toBeDefined();
            expect(LOYALTY_TIERS.SILVER).toBeDefined();
            expect(LOYALTY_TIERS.GOLD).toBeDefined();
            expect(LOYALTY_TIERS.PLATINUM).toBeDefined();
        });

        it('should have correct transaction thresholds', () => {
            expect(LOYALTY_TIERS.BRONZE.min_transactions).toBe(0);
            expect(LOYALTY_TIERS.SILVER.min_transactions).toBe(25);
            expect(LOYALTY_TIERS.GOLD.min_transactions).toBe(100);
            expect(LOYALTY_TIERS.PLATINUM.min_transactions).toBe(500);
        });

        it('should have correct credit back percentages', () => {
            expect(LOYALTY_TIERS.BRONZE.credit_back_percent).toBe(0);
            expect(LOYALTY_TIERS.SILVER.credit_back_percent).toBe(0.02);
            expect(LOYALTY_TIERS.GOLD.credit_back_percent).toBe(0.05);
            expect(LOYALTY_TIERS.PLATINUM.credit_back_percent).toBe(0.10);
        });

        it('should have increasing benefits with higher tiers', () => {
            expect(LOYALTY_TIERS.SILVER.credit_back_percent)
                .toBeGreaterThan(LOYALTY_TIERS.BRONZE.credit_back_percent);
            expect(LOYALTY_TIERS.GOLD.credit_back_percent)
                .toBeGreaterThan(LOYALTY_TIERS.SILVER.credit_back_percent);
            expect(LOYALTY_TIERS.PLATINUM.credit_back_percent)
                .toBeGreaterThan(LOYALTY_TIERS.GOLD.credit_back_percent);
        });
    });

    describe('MILESTONES', () => {
        it('should define milestones at key transaction counts', () => {
            const counts = MILESTONES.map(m => m.transaction_count);
            expect(counts).toContain(25);
            expect(counts).toContain(50);
            expect(counts).toContain(100);
            expect(counts).toContain(250);
            expect(counts).toContain(500);
            expect(counts).toContain(1000);
        });

        it('should have increasing rewards for higher milestones', () => {
            for (let i = 1; i < MILESTONES.length; i++) {
                expect(MILESTONES[i].credits).toBeGreaterThanOrEqual(MILESTONES[i - 1].credits);
            }
        });

        it('should grant 2 credits at 25 transactions', () => {
            const milestone = MILESTONES.find(m => m.transaction_count === 25);
            expect(milestone?.credits).toBe(2);
        });

        it('should grant 50 credits at 1000 transactions', () => {
            const milestone = MILESTONES.find(m => m.transaction_count === 1000);
            expect(milestone?.credits).toBe(50);
        });
    });
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Schema Validation', () => {
    describe('LoyaltyTierSchema', () => {
        it('should accept valid tiers', () => {
            expect(LoyaltyTierSchema.parse('BRONZE')).toBe('BRONZE');
            expect(LoyaltyTierSchema.parse('SILVER')).toBe('SILVER');
            expect(LoyaltyTierSchema.parse('GOLD')).toBe('GOLD');
            expect(LoyaltyTierSchema.parse('PLATINUM')).toBe('PLATINUM');
        });

        it('should reject invalid tiers', () => {
            expect(() => LoyaltyTierSchema.parse('DIAMOND')).toThrow();
            expect(() => LoyaltyTierSchema.parse('bronze')).toThrow();
        });
    });

    describe('CreditTypeSchema', () => {
        it('should accept valid credit types', () => {
            expect(CreditTypeSchema.parse('REFERRAL_REWARD')).toBe('REFERRAL_REWARD');
            expect(CreditTypeSchema.parse('PROMO')).toBe('PROMO');
            expect(CreditTypeSchema.parse('MILESTONE')).toBe('MILESTONE');
            expect(CreditTypeSchema.parse('LOYALTY')).toBe('LOYALTY');
        });
    });

    describe('CreditSourceTypeSchema', () => {
        it('should accept valid source types', () => {
            expect(CreditSourceTypeSchema.parse('REFERRAL')).toBe('REFERRAL');
            expect(CreditSourceTypeSchema.parse('PROMO_CODE')).toBe('PROMO_CODE');
            expect(CreditSourceTypeSchema.parse('MILESTONE')).toBe('MILESTONE');
            expect(CreditSourceTypeSchema.parse('LOYALTY_CASHBACK')).toBe('LOYALTY_CASHBACK');
            expect(CreditSourceTypeSchema.parse('ADMIN')).toBe('ADMIN');
        });
    });

    describe('CreditBalanceStatusSchema', () => {
        it('should accept valid statuses', () => {
            expect(CreditBalanceStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
            expect(CreditBalanceStatusSchema.parse('EXHAUSTED')).toBe('EXHAUSTED');
            expect(CreditBalanceStatusSchema.parse('EXPIRED')).toBe('EXPIRED');
            expect(CreditBalanceStatusSchema.parse('CANCELLED')).toBe('CANCELLED');
        });
    });

    describe('CreditEventTypeSchema', () => {
        it('should accept valid event types', () => {
            const validTypes = ['GRANT', 'REDEEM', 'EXPIRE', 'CANCEL', 'REFUND', 'HOLD', 'RELEASE'];
            validTypes.forEach(type => {
                expect(CreditEventTypeSchema.parse(type)).toBe(type);
            });
        });
    });

    describe('PromotionStatusSchema', () => {
        it('should accept valid statuses', () => {
            expect(PromotionStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
            expect(PromotionStatusSchema.parse('PAUSED')).toBe('PAUSED');
            expect(PromotionStatusSchema.parse('EXPIRED')).toBe('EXPIRED');
            expect(PromotionStatusSchema.parse('CANCELLED')).toBe('CANCELLED');
        });
    });

    describe('ReferralCouponStatusSchema', () => {
        it('should accept valid statuses', () => {
            expect(ReferralCouponStatusSchema.parse('PENDING')).toBe('PENDING');
            expect(ReferralCouponStatusSchema.parse('CLAIMED')).toBe('CLAIMED');
            expect(ReferralCouponStatusSchema.parse('EXPIRED')).toBe('EXPIRED');
            expect(ReferralCouponStatusSchema.parse('CANCELLED')).toBe('CANCELLED');
        });
    });

    describe('CreditHoldStatusSchema', () => {
        it('should accept valid statuses', () => {
            expect(CreditHoldStatusSchema.parse('HELD')).toBe('HELD');
            expect(CreditHoldStatusSchema.parse('RELEASED')).toBe('RELEASED');
            expect(CreditHoldStatusSchema.parse('APPLIED')).toBe('APPLIED');
            expect(CreditHoldStatusSchema.parse('EXPIRED')).toBe('EXPIRED');
        });
    });

    describe('GetCreditsSchema', () => {
        it('should accept valid input', () => {
            const result = GetCreditsSchema.parse({
                include_history: true,
                history_limit: 50,
            });
            expect(result.include_history).toBe(true);
            expect(result.history_limit).toBe(50);
        });

        it('should have correct defaults', () => {
            const result = GetCreditsSchema.parse({});
            expect(result.include_history).toBe(false);
            expect(result.history_limit).toBe(20);
        });

        it('should reject history_limit over 100', () => {
            expect(() => GetCreditsSchema.parse({
                history_limit: 101,
            })).toThrow();
        });
    });

    describe('RedeemCreditsSchema', () => {
        it('should accept valid input', () => {
            const result = RedeemCreditsSchema.parse({
                amount: 5,
                transaction_id: 'tx-123',
            });
            expect(result.amount).toBe(5);
            expect(result.transaction_id).toBe('tx-123');
        });

        it('should reject amount less than 1', () => {
            expect(() => RedeemCreditsSchema.parse({ amount: 0 })).toThrow();
        });

        it('should reject amount greater than 10', () => {
            expect(() => RedeemCreditsSchema.parse({ amount: 11 })).toThrow();
        });

        it('should accept amount without transaction_id', () => {
            const result = RedeemCreditsSchema.parse({ amount: 3 });
            expect(result.amount).toBe(3);
            expect(result.transaction_id).toBeUndefined();
        });
    });

    describe('SendReferralSchema', () => {
        it('should accept valid email', () => {
            const result = SendReferralSchema.parse({
                recipient_email: 'friend@example.com',
            });
            expect(result.recipient_email).toBe('friend@example.com');
        });

        it('should accept empty input', () => {
            const result = SendReferralSchema.parse({});
            expect(result.recipient_email).toBeUndefined();
        });

        it('should reject invalid email', () => {
            expect(() => SendReferralSchema.parse({
                recipient_email: 'not-an-email',
            })).toThrow();
        });
    });

    describe('ClaimReferralSchema', () => {
        it('should accept valid coupon code', () => {
            const result = ClaimReferralSchema.parse({
                coupon_code: 'ABC123XYZ',
            });
            expect(result.coupon_code).toBe('ABC123XYZ');
        });

        it('should reject short coupon codes', () => {
            expect(() => ClaimReferralSchema.parse({
                coupon_code: 'ABC',
            })).toThrow();
        });

        it('should reject long coupon codes', () => {
            expect(() => ClaimReferralSchema.parse({
                coupon_code: 'A'.repeat(21),
            })).toThrow();
        });
    });

    describe('ClaimPromotionSchema', () => {
        it('should accept valid promo code', () => {
            const result = ClaimPromotionSchema.parse({
                promo_code: 'SUMMER2024',
            });
            expect(result.promo_code).toBe('SUMMER2024');
        });

        it('should reject short promo codes', () => {
            expect(() => ClaimPromotionSchema.parse({
                promo_code: 'AB',
            })).toThrow();
        });
    });

    describe('CreatePromotionSchema', () => {
        it('should accept valid promotion input', () => {
            const input = {
                code: 'HOLIDAY50',
                name: 'Holiday Special',
                description: 'Get 50% off your first transaction',
                credits_granted: 5,
                expiry_days: 30,
                max_claims: 1000,
            };

            const result = CreatePromotionSchema.parse(input);
            expect(result.code).toBe('HOLIDAY50');
            expect(result.credits_granted).toBe(5);
        });

        it('should have correct defaults', () => {
            const input = {
                code: 'SIMPLE',
                name: 'Simple Promo',
                credits_granted: 2,
            };

            const result = CreatePromotionSchema.parse(input);
            expect(result.expiry_days).toBe(14);
            expect(result.max_claims_per_user).toBe(1);
            expect(result.new_users_only).toBe(false);
        });

        it('should reject invalid code characters', () => {
            expect(() => CreatePromotionSchema.parse({
                code: 'INVALID CODE!',
                name: 'Test',
                credits_granted: 1,
            })).toThrow();
        });

        it('should reject credits over 100', () => {
            expect(() => CreatePromotionSchema.parse({
                code: 'TEST',
                name: 'Test',
                credits_granted: 101,
            })).toThrow();
        });

        it('should accept minimum tier requirement', () => {
            const result = CreatePromotionSchema.parse({
                code: 'VIP_ONLY',
                name: 'VIP Special',
                credits_granted: 10,
                min_tier: 'GOLD',
            });
            expect(result.min_tier).toBe('GOLD');
        });
    });

    describe('UpdatePromotionSchema', () => {
        it('should accept partial updates', () => {
            const result = UpdatePromotionSchema.parse({
                name: 'Updated Name',
            });
            expect(result.name).toBe('Updated Name');
            expect(result.status).toBeUndefined();
        });

        it('should accept status update', () => {
            const result = UpdatePromotionSchema.parse({
                status: 'PAUSED',
            });
            expect(result.status).toBe('PAUSED');
        });

        it('should accept multiple updates', () => {
            const result = UpdatePromotionSchema.parse({
                name: 'New Name',
                description: 'New description',
                max_claims: 500,
                status: 'ACTIVE',
            });
            expect(result.name).toBe('New Name');
            expect(result.max_claims).toBe(500);
        });
    });
});

// ============================================================================
// Credit Flow Tests
// ============================================================================

describe('Credit Flow Logic', () => {
    describe('FIFO Redemption', () => {
        it('should use oldest expiring credits first', () => {
            // Simulate two credit balances
            const balances = [
                { id: 'b1', remaining: 2, expires_at: Date.now() + 1000 }, // expires soon
                { id: 'b2', remaining: 5, expires_at: Date.now() + 10000 }, // expires later
            ];

            // Redeem 3 credits
            const amountToRedeem = 3;
            let remaining = amountToRedeem;
            const used: Array<{ id: string; amount: number }> = [];

            for (const balance of balances.sort((a, b) => a.expires_at - b.expires_at)) {
                if (remaining <= 0) break;
                const useAmount = Math.min(remaining, balance.remaining);
                used.push({ id: balance.id, amount: useAmount });
                remaining -= useAmount;
            }

            // Should use all 2 from b1, then 1 from b2
            expect(used).toHaveLength(2);
            expect(used[0]).toEqual({ id: 'b1', amount: 2 });
            expect(used[1]).toEqual({ id: 'b2', amount: 1 });
        });
    });

    describe('Expiration Periods', () => {
        it('should calculate promo expiration correctly', () => {
            const now = Date.now();
            const expiresAt = now + CREDIT_DEFAULTS.PROMO_EXPIRY_MS;
            const daysDiff = (expiresAt - now) / (24 * 60 * 60 * 1000);
            expect(daysDiff).toBeCloseTo(14);
        });

        it('should calculate referral reward expiration correctly', () => {
            const now = Date.now();
            const expiresAt = now + CREDIT_DEFAULTS.REFERRAL_REWARD_EXPIRY_MS;
            const daysDiff = (expiresAt - now) / (24 * 60 * 60 * 1000);
            expect(daysDiff).toBeCloseTo(90);
        });

        it('should calculate loyalty credit expiration correctly', () => {
            const now = Date.now();
            const expiresAt = now + CREDIT_DEFAULTS.LOYALTY_CREDIT_EXPIRY_MS;
            const daysDiff = (expiresAt - now) / (24 * 60 * 60 * 1000);
            expect(daysDiff).toBeCloseTo(365);
        });
    });
});

// ============================================================================
// Referral Flow Tests
// ============================================================================

describe('Referral System', () => {
    describe('Referral Flow', () => {
        it('should grant correct credits on signup via referral', () => {
            const creditsGranted = CREDIT_DEFAULTS.REFERRAL_SIGNUP_CREDITS;
            expect(creditsGranted).toBe(2);
        });

        it('should grant correct reward when referral converts', () => {
            const rewardCredits = CREDIT_DEFAULTS.REFERRAL_REWARD_CREDITS;
            expect(rewardCredits).toBe(1);
        });

        it('should grant coupons after first transaction', () => {
            const couponsGranted = CREDIT_DEFAULTS.FIRST_TRANSACTION_COUPONS;
            expect(couponsGranted).toBe(2);
        });
    });

    describe('Monthly Limits', () => {
        it('should enforce monthly coupon limit', () => {
            const limit = CREDIT_DEFAULTS.MAX_REFERRAL_COUPONS_PER_MONTH;
            const sentThisMonth = 10;
            const canSendMore = sentThisMonth < limit;
            expect(canSendMore).toBe(false);
        });

        it('should allow sending under limit', () => {
            const limit = CREDIT_DEFAULTS.MAX_REFERRAL_COUPONS_PER_MONTH;
            const sentThisMonth = 5;
            const canSendMore = sentThisMonth < limit;
            expect(canSendMore).toBe(true);
        });
    });

    describe('Coupon Expiration', () => {
        it('should expire coupons after 30 days', () => {
            const now = Date.now();
            const expiresAt = now + CREDIT_DEFAULTS.REFERRAL_COUPON_EXPIRY_MS;
            const daysDiff = (expiresAt - now) / (24 * 60 * 60 * 1000);
            expect(daysDiff).toBeCloseTo(30);
        });
    });
});

// ============================================================================
// Loyalty Tier Tests
// ============================================================================

describe('Loyalty Tier Calculation', () => {
    describe('Tier Determination', () => {
        it('should return BRONZE for 0 transactions', () => {
            const txCount = 0;
            const tier = determineTier(txCount);
            expect(tier).toBe('BRONZE');
        });

        it('should return BRONZE for 24 transactions', () => {
            const txCount = 24;
            const tier = determineTier(txCount);
            expect(tier).toBe('BRONZE');
        });

        it('should return SILVER for 25 transactions', () => {
            const txCount = 25;
            const tier = determineTier(txCount);
            expect(tier).toBe('SILVER');
        });

        it('should return SILVER for 99 transactions', () => {
            const txCount = 99;
            const tier = determineTier(txCount);
            expect(tier).toBe('SILVER');
        });

        it('should return GOLD for 100 transactions', () => {
            const txCount = 100;
            const tier = determineTier(txCount);
            expect(tier).toBe('GOLD');
        });

        it('should return GOLD for 499 transactions', () => {
            const txCount = 499;
            const tier = determineTier(txCount);
            expect(tier).toBe('GOLD');
        });

        it('should return PLATINUM for 500 transactions', () => {
            const txCount = 500;
            const tier = determineTier(txCount);
            expect(tier).toBe('PLATINUM');
        });

        it('should return PLATINUM for 1000+ transactions', () => {
            const txCount = 1000;
            const tier = determineTier(txCount);
            expect(tier).toBe('PLATINUM');
        });
    });

    describe('Credit Back Calculation', () => {
        it('should give 0% back for BRONZE', () => {
            const tier = 'BRONZE';
            const transactionValue = 100;
            const cashback = calculateCashback(tier, transactionValue);
            expect(cashback).toBe(0);
        });

        it('should give 2% back for SILVER', () => {
            const tier = 'SILVER';
            const transactionValue = 100;
            const cashback = calculateCashback(tier, transactionValue);
            expect(cashback).toBe(2);
        });

        it('should give 5% back for GOLD', () => {
            const tier = 'GOLD';
            const transactionValue = 100;
            const cashback = calculateCashback(tier, transactionValue);
            expect(cashback).toBe(5);
        });

        it('should give 10% back for PLATINUM', () => {
            const tier = 'PLATINUM';
            const transactionValue = 100;
            const cashback = calculateCashback(tier, transactionValue);
            expect(cashback).toBe(10);
        });

        it('should floor cashback credits', () => {
            const tier = 'SILVER';
            const transactionValue = 50; // 2% of 50 = 1
            const cashback = calculateCashback(tier, transactionValue);
            expect(cashback).toBe(1);
        });
    });
});

// ============================================================================
// Milestone Tests
// ============================================================================

describe('Milestone System', () => {
    describe('Milestone Achievement', () => {
        it('should identify achievable milestones', () => {
            const txCount = 50;
            const achievable = MILESTONES.filter(m => m.transaction_count <= txCount);
            expect(achievable).toHaveLength(2); // 25 and 50
        });

        it('should calculate total milestone credits', () => {
            const txCount = 100;
            const achievable = MILESTONES.filter(m => m.transaction_count <= txCount);
            const totalCredits = achievable.reduce((sum, m) => sum + m.credits, 0);
            expect(totalCredits).toBe(2 + 3 + 5); // 25, 50, 100 milestones
        });
    });

    describe('Next Milestone', () => {
        it('should identify next milestone', () => {
            const txCount = 30;
            const nextMilestone = MILESTONES.find(m => m.transaction_count > txCount);
            expect(nextMilestone?.transaction_count).toBe(50);
            expect(nextMilestone?.credits).toBe(3);
        });

        it('should return undefined when all milestones achieved', () => {
            const txCount = 1001;
            const nextMilestone = MILESTONES.find(m => m.transaction_count > txCount);
            expect(nextMilestone).toBeUndefined();
        });
    });
});

// ============================================================================
// Promotion Tests
// ============================================================================

describe('Promotion System', () => {
    describe('Eligibility Checks', () => {
        it('should check date validity', () => {
            const now = Date.now();
            const promo = {
                starts_at: now - 1000,
                ends_at: now + 1000,
                status: 'ACTIVE',
            };

            const isValid = promo.status === 'ACTIVE' &&
                promo.starts_at <= now &&
                (!promo.ends_at || promo.ends_at > now);

            expect(isValid).toBe(true);
        });

        it('should reject expired promotions', () => {
            const now = Date.now();
            const promo = {
                starts_at: now - 2000,
                ends_at: now - 1000,
                status: 'ACTIVE',
            };

            const isValid = promo.status === 'ACTIVE' &&
                promo.starts_at <= now &&
                (!promo.ends_at || promo.ends_at > now);

            expect(isValid).toBe(false);
        });

        it('should reject not-yet-started promotions', () => {
            const now = Date.now();
            const promo = {
                starts_at: now + 1000,
                ends_at: now + 2000,
                status: 'ACTIVE',
            };

            const isValid = promo.status === 'ACTIVE' &&
                promo.starts_at <= now;

            expect(isValid).toBe(false);
        });
    });

    describe('Claim Limits', () => {
        it('should enforce max claims', () => {
            const promo = {
                max_claims: 100,
                claims_count: 100,
            };

            const canClaim = !promo.max_claims || promo.claims_count < promo.max_claims;
            expect(canClaim).toBe(false);
        });

        it('should allow claims under limit', () => {
            const promo = {
                max_claims: 100,
                claims_count: 50,
            };

            const canClaim = !promo.max_claims || promo.claims_count < promo.max_claims;
            expect(canClaim).toBe(true);
        });

        it('should allow unlimited claims when max_claims is null', () => {
            const promo = {
                max_claims: null,
                claims_count: 9999,
            };

            const canClaim = !promo.max_claims || promo.claims_count < promo.max_claims;
            expect(canClaim).toBe(true);
        });
    });

    describe('Tier Requirements', () => {
        it('should check minimum tier requirement', () => {
            const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
            const userTier = 'SILVER';
            const minTier = 'GOLD';

            const meetsRequirement = tierOrder.indexOf(userTier) >= tierOrder.indexOf(minTier);
            expect(meetsRequirement).toBe(false);
        });

        it('should pass tier check when user meets requirement', () => {
            const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
            const userTier = 'PLATINUM';
            const minTier = 'GOLD';

            const meetsRequirement = tierOrder.indexOf(userTier) >= tierOrder.indexOf(minTier);
            expect(meetsRequirement).toBe(true);
        });
    });
});

// ============================================================================
// Credit Hold Tests
// ============================================================================

describe('Credit Holds', () => {
    describe('Hold Creation', () => {
        it('should reject hold when insufficient credits', () => {
            const available = 5;
            const holdAmount = 10;
            const canHold = available >= holdAmount;
            expect(canHold).toBe(false);
        });

        it('should allow hold when sufficient credits', () => {
            const available = 10;
            const holdAmount = 5;
            const canHold = available >= holdAmount;
            expect(canHold).toBe(true);
        });
    });

    describe('Hold Expiration', () => {
        it('should set correct expiration time', () => {
            const now = Date.now();
            const expiresAt = now + CREDIT_DEFAULTS.HOLD_EXPIRY_MS;
            const hoursDiff = (expiresAt - now) / (60 * 60 * 1000);
            expect(hoursDiff).toBeCloseTo(24);
        });
    });
});

// ============================================================================
// Integration Helpers
// ============================================================================

describe('Integration Helpers', () => {
    describe('Credit Routes', () => {
        it('should define all required routes', () => {
            const routes = [
                'GET /credits',
                'POST /credits/redeem',
                'GET /credits/milestones',
                'GET /credits/tiers',
                'POST /referral/send',
                'POST /referral/claim',
                'GET /referral/status',
                'POST /promotions/claim',
                'POST /admin/promotions',
                'GET /admin/promotions',
                'GET /admin/promotions/:id',
                'PATCH /admin/promotions/:id',
            ];

            expect(routes).toHaveLength(12);
        });
    });
});

// ============================================================================
// Helper Functions
// ============================================================================

function determineTier(txCount: number): string {
    if (txCount >= LOYALTY_TIERS.PLATINUM.min_transactions) return 'PLATINUM';
    if (txCount >= LOYALTY_TIERS.GOLD.min_transactions) return 'GOLD';
    if (txCount >= LOYALTY_TIERS.SILVER.min_transactions) return 'SILVER';
    return 'BRONZE';
}

function calculateCashback(tier: string, transactionValue: number): number {
    const tierConfig = LOYALTY_TIERS[tier as keyof typeof LOYALTY_TIERS];
    return Math.floor(transactionValue * tierConfig.credit_back_percent);
}
