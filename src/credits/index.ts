/**
 * Credits & Loyalty Module
 *
 * Universal credit ledger for referrals, promotions, and loyalty rewards.
 */

// Re-export all types
export * from './types';

// Export core credit operations
export {
    getOrCreateUserCredits,
    getCreditSummary,
    getCreditHistory,
    grantCredits,
    redeemCredits,
    holdCredits,
    releaseHold,
    applyHold,
    expireCredits,
    expireHolds,
    syncUserBalance,
} from './core';

export type { GrantCreditsInput, RedeemCreditsResult } from './core';

// Export referral operations
export {
    generateReferralCoupon,
    generateReferralLink,
    claimReferralCoupon,
    processReferralConversion,
    grantFirstTransactionCoupons,
    getReferralStatus,
    expireReferralCoupons,
} from './referrals';

// Export loyalty operations
export {
    processTransactionCompletion,
    getLoyaltyTierConfig,
    getAllLoyaltyTiers,
    getMilestoneProgress,
    getLeaderboard,
    getTierDistribution,
} from './loyalty';

// Export promotion operations
export {
    createPromotion,
    updatePromotion,
    getPromotion,
    getPromotionByCode,
    listPromotions,
    claimPromotion,
    getUserPromotionClaims,
    expirePromotions,
} from './promotions';
