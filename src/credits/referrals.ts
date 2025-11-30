/**
 * Referral System
 *
 * Manages referral coupons, claims, and conversion tracking.
 *
 * Flow:
 * 1. User completes first PAID transaction → earns 2 referral coupons
 * 2. User sends coupon to non-registered friend
 * 3. Friend signs up using coupon → gets 2 promo credits
 * 4. Friend completes first PAID transaction → referrer gets 1 free transaction credit
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type { ReferralCoupon, UserCredits } from '../db/types';
import { CREDIT_DEFAULTS, ReferralStatus } from './types';
import { grantCredits, getOrCreateUserCredits } from './core';

// ============================================================================
// Referral Coupon Generation
// ============================================================================

/**
 * Generate a referral coupon for a user to send
 */
export async function generateReferralCoupon(
    env: Env,
    senderUserId: string,
    recipientEmail?: string
): Promise<{ ok: true; coupon: ReferralCoupon } | { ok: false; error: string }> {
    const userCredits = await getOrCreateUserCredits(env, senderUserId);

    // Check if user has coupons available
    if (userCredits.referral_coupons_available <= 0) {
        return { ok: false, error: 'No referral coupons available' };
    }

    // Check monthly limit
    const monthStart = getMonthStart();
    const sentThisMonth = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM referral_coupons
         WHERE sender_user_id = ? AND created_at >= ?`,
        [senderUserId, monthStart]
    );

    if ((sentThisMonth?.count ?? 0) >= CREDIT_DEFAULTS.MAX_REFERRAL_COUPONS_PER_MONTH) {
        return { ok: false, error: 'Monthly referral limit reached' };
    }

    // If recipient email provided, check they're not already a user
    if (recipientEmail) {
        const existingUser = await queryOne(
            env.TATTLEHASH_DB,
            'SELECT id FROM users WHERE email = ?',
            [recipientEmail.toLowerCase()]
        );
        if (existingUser) {
            return { ok: false, error: 'Recipient is already a registered user' };
        }

        // Check if coupon already sent to this email
        const existingCoupon = await queryOne(
            env.TATTLEHASH_DB,
            `SELECT id FROM referral_coupons
             WHERE sender_user_id = ? AND recipient_email = ? AND status = 'PENDING'`,
            [senderUserId, recipientEmail.toLowerCase()]
        );
        if (existingCoupon) {
            return { ok: false, error: 'Coupon already sent to this email' };
        }
    }

    const couponId = crypto.randomUUID();
    const couponCode = generateCouponCode();
    const now = Date.now();
    const expiresAt = now + CREDIT_DEFAULTS.REFERRAL_COUPON_EXPIRY_MS;

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO referral_coupons (
            id, sender_user_id, coupon_code, recipient_email,
            status, converted, reward_granted, expires_at, created_at
        ) VALUES (?, ?, ?, ?, 'PENDING', 0, 0, ?, ?)`,
        [couponId, senderUserId, couponCode, recipientEmail?.toLowerCase() ?? null, expiresAt, now]
    );

    // Decrement available coupons, increment sent
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            referral_coupons_available = referral_coupons_available - 1,
            referral_coupons_sent = referral_coupons_sent + 1,
            updated_at = ?
         WHERE user_id = ?`,
        [now, senderUserId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'referral_coupon_generated',
        sender_user_id: senderUserId,
        coupon_code: couponCode,
    }));

    return {
        ok: true,
        coupon: {
            id: couponId,
            sender_user_id: senderUserId,
            coupon_code: couponCode,
            recipient_email: recipientEmail?.toLowerCase(),
            status: 'PENDING',
            converted: false,
            reward_granted: false,
            expires_at: expiresAt,
            created_at: now,
        },
    };
}

/**
 * Generate referral link URL
 */
export function generateReferralLink(couponCode: string, baseUrl: string): string {
    return `${baseUrl}/signup?ref=${couponCode}`;
}

// ============================================================================
// Referral Claiming
// ============================================================================

/**
 * Claim a referral coupon during signup
 */
export async function claimReferralCoupon(
    env: Env,
    couponCode: string,
    newUserId: string
): Promise<{ ok: true; credits_granted: number } | { ok: false; error: string }> {
    const coupon = await queryOne<ReferralCoupon>(
        env.TATTLEHASH_DB,
        `SELECT * FROM referral_coupons WHERE coupon_code = ?`,
        [couponCode.toUpperCase()]
    );

    if (!coupon) {
        return { ok: false, error: 'Invalid referral code' };
    }

    if (coupon.status !== 'PENDING') {
        return { ok: false, error: 'Referral code already used or expired' };
    }

    if (coupon.expires_at < Date.now()) {
        // Mark as expired
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE referral_coupons SET status = 'EXPIRED' WHERE id = ?`,
            [coupon.id]
        );
        return { ok: false, error: 'Referral code has expired' };
    }

    const now = Date.now();

    // Mark coupon as claimed
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE referral_coupons SET
            status = 'CLAIMED',
            claimed_by_user_id = ?,
            claimed_at = ?
         WHERE id = ?`,
        [newUserId, now, coupon.id]
    );

    // Set referred_by on new user
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            referred_by_user_id = ?,
            updated_at = ?
         WHERE user_id = ?`,
        [coupon.sender_user_id, now, newUserId]
    );

    // Grant promo credits to new user
    await grantCredits(env, {
        userId: newUserId,
        creditType: 'PROMO',
        amount: CREDIT_DEFAULTS.REFERRAL_SIGNUP_CREDITS,
        sourceType: 'REFERRAL',
        sourceId: coupon.id,
        description: `Welcome bonus from referral`,
        expiresAt: now + CREDIT_DEFAULTS.PROMO_EXPIRY_MS,
    });

    console.log(JSON.stringify({
        t: now,
        at: 'referral_claimed',
        coupon_code: couponCode,
        new_user_id: newUserId,
        referrer_user_id: coupon.sender_user_id,
    }));

    return {
        ok: true,
        credits_granted: CREDIT_DEFAULTS.REFERRAL_SIGNUP_CREDITS,
    };
}

// ============================================================================
// Referral Conversion (when referred user completes first paid transaction)
// ============================================================================

/**
 * Process referral conversion when user completes first paid transaction
 */
export async function processReferralConversion(
    env: Env,
    userId: string
): Promise<{ converted: boolean; referrer_rewarded: boolean }> {
    const userCredits = await getOrCreateUserCredits(env, userId);

    // Check if this is their first paid transaction
    if (userCredits.lifetime_transactions > 1) {
        return { converted: false, referrer_rewarded: false };
    }

    // Find the referral coupon used by this user
    const coupon = await queryOne<ReferralCoupon>(
        env.TATTLEHASH_DB,
        `SELECT * FROM referral_coupons
         WHERE claimed_by_user_id = ? AND status = 'CLAIMED' AND converted = 0`,
        [userId]
    );

    if (!coupon) {
        return { converted: false, referrer_rewarded: false };
    }

    const now = Date.now();

    // Mark as converted
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE referral_coupons SET
            converted = 1,
            converted_at = ?
         WHERE id = ?`,
        [now, coupon.id]
    );

    // Grant reward to referrer
    await grantCredits(env, {
        userId: coupon.sender_user_id,
        creditType: 'REFERRAL_REWARD',
        amount: CREDIT_DEFAULTS.REFERRAL_REWARD_CREDITS,
        sourceType: 'REFERRAL',
        sourceId: coupon.id,
        description: 'Referral conversion reward',
    });

    // Mark reward as granted
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE referral_coupons SET
            reward_granted = 1,
            reward_granted_at = ?
         WHERE id = ?`,
        [now, coupon.id]
    );

    // Update referrer's conversion count
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            referral_conversions = referral_conversions + 1,
            updated_at = ?
         WHERE user_id = ?`,
        [now, coupon.sender_user_id]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'referral_converted',
        referred_user_id: userId,
        referrer_user_id: coupon.sender_user_id,
    }));

    return { converted: true, referrer_rewarded: true };
}

// ============================================================================
// First Transaction Bonus (earn referral coupons)
// ============================================================================

/**
 * Grant referral coupons when user completes first paid transaction
 */
export async function grantFirstTransactionCoupons(
    env: Env,
    userId: string
): Promise<{ coupons_granted: number }> {
    const userCredits = await getOrCreateUserCredits(env, userId);

    // Only grant on first transaction
    if (userCredits.lifetime_transactions > 1) {
        return { coupons_granted: 0 };
    }

    // Check if already has coupons (prevent duplicate grants)
    if (userCredits.referral_coupons_available > 0 || userCredits.referral_coupons_sent > 0) {
        return { coupons_granted: 0 };
    }

    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            referral_coupons_available = ?,
            updated_at = ?
         WHERE user_id = ?`,
        [CREDIT_DEFAULTS.FIRST_TRANSACTION_COUPONS, now, userId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'first_transaction_coupons_granted',
        user_id: userId,
        coupons: CREDIT_DEFAULTS.FIRST_TRANSACTION_COUPONS,
    }));

    return { coupons_granted: CREDIT_DEFAULTS.FIRST_TRANSACTION_COUPONS };
}

// ============================================================================
// Referral Status
// ============================================================================

/**
 * Get referral status for a user
 */
export async function getReferralStatus(
    env: Env,
    userId: string
): Promise<ReferralStatus> {
    const userCredits = await getOrCreateUserCredits(env, userId);

    const pendingReferrals = await query<ReferralCoupon>(
        env.TATTLEHASH_DB,
        `SELECT coupon_code, recipient_email, status, created_at, expires_at
         FROM referral_coupons
         WHERE sender_user_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC`,
        [userId]
    );

    return {
        referral_code: userCredits.referral_code ?? '',
        coupons_available: userCredits.referral_coupons_available,
        coupons_sent: userCredits.referral_coupons_sent,
        conversions: userCredits.referral_conversions,
        pending_referrals: pendingReferrals.map(r => ({
            coupon_code: r.coupon_code,
            recipient_email: r.recipient_email,
            status: r.status,
            created_at: r.created_at,
            expires_at: r.expires_at,
        })),
    };
}

// ============================================================================
// Expiration
// ============================================================================

/**
 * Expire stale referral coupons (called by cron)
 */
export async function expireReferralCoupons(env: Env): Promise<number> {
    const now = Date.now();

    // Count before updating
    const toExpire = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT id FROM referral_coupons WHERE status = 'PENDING' AND expires_at <= ?`,
        [now]
    );

    if (toExpire.length === 0) return 0;

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE referral_coupons SET status = 'EXPIRED'
         WHERE status = 'PENDING' AND expires_at <= ?`,
        [now]
    );

    return toExpire.length;
}

// ============================================================================
// Helpers
// ============================================================================

function generateCouponCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const array = new Uint8Array(10);
    crypto.getRandomValues(array);
    for (let i = 0; i < 10; i++) {
        code += chars[array[i] % chars.length];
    }
    return code;
}

function getMonthStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}
