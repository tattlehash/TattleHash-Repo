/**
 * Promotions Module
 *
 * Manages admin-created promotional codes and user claims.
 * Platform-neutral: no partner/sponsor promotions.
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type { Promotion, PromotionClaim } from '../db/types';
import {
    CreatePromotionInput,
    UpdatePromotionInput,
    CREDIT_DEFAULTS,
    LoyaltyTier,
} from './types';
import { grantCredits, getOrCreateUserCredits } from './core';

// ============================================================================
// Admin: Create Promotion
// ============================================================================

/**
 * Create a new promotion (admin only)
 */
export async function createPromotion(
    env: Env,
    input: CreatePromotionInput,
    adminUserId: string
): Promise<Promotion> {
    const promoId = crypto.randomUUID();
    const now = Date.now();

    // Check code doesn't already exist
    const existing = await queryOne(
        env.TATTLEHASH_DB,
        'SELECT id FROM promotions WHERE code = ?',
        [input.code.toUpperCase()]
    );

    if (existing) {
        throw new Error('Promotion code already exists');
    }

    const startsAt = input.starts_at ?? now;
    const endsAt = input.ends_at ?? null;

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO promotions (
            id, code, name, description, credits_granted, credit_type,
            expiry_days, max_claims, claims_count, max_claims_per_user,
            new_users_only, min_tier, starts_at, ends_at, status,
            created_at, created_by_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PROMO', ?, ?, 0, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [
            promoId,
            input.code.toUpperCase(),
            input.name,
            input.description ?? null,
            input.credits_granted,
            input.expiry_days,
            input.max_claims ?? null,
            input.max_claims_per_user,
            input.new_users_only ? 1 : 0,
            input.min_tier ?? null,
            startsAt,
            endsAt,
            now,
            adminUserId,
            now,
        ]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'promotion_created',
        promo_id: promoId,
        code: input.code.toUpperCase(),
        created_by: adminUserId,
    }));

    return {
        id: promoId,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description,
        credits_granted: input.credits_granted,
        credit_type: 'PROMO',
        expiry_days: input.expiry_days,
        max_claims: input.max_claims,
        claims_count: 0,
        max_claims_per_user: input.max_claims_per_user,
        new_users_only: input.new_users_only ?? false,
        min_tier: input.min_tier,
        starts_at: startsAt,
        ends_at: endsAt ?? undefined,
        status: 'ACTIVE',
        created_at: now,
        created_by_user_id: adminUserId,
        updated_at: now,
    };
}

/**
 * Update a promotion (admin only)
 */
export async function updatePromotion(
    env: Env,
    promoId: string,
    input: UpdatePromotionInput
): Promise<Promotion | null> {
    const promo = await queryOne<Promotion>(
        env.TATTLEHASH_DB,
        'SELECT * FROM promotions WHERE id = ?',
        [promoId]
    );

    if (!promo) return null;

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.name !== undefined) {
        updates.push('name = ?');
        values.push(input.name);
    }
    if (input.description !== undefined) {
        updates.push('description = ?');
        values.push(input.description);
    }
    if (input.max_claims !== undefined) {
        updates.push('max_claims = ?');
        values.push(input.max_claims);
    }
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
    }
    if (input.ends_at !== undefined) {
        updates.push('ends_at = ?');
        values.push(input.ends_at);
    }

    if (updates.length === 0) return promo;

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(promoId);

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE promotions SET ${updates.join(', ')} WHERE id = ?`,
        values
    );

    return queryOne<Promotion>(
        env.TATTLEHASH_DB,
        'SELECT * FROM promotions WHERE id = ?',
        [promoId]
    );
}

/**
 * Get promotion by code
 */
export async function getPromotionByCode(
    env: Env,
    code: string
): Promise<Promotion | null> {
    return queryOne<Promotion>(
        env.TATTLEHASH_DB,
        'SELECT * FROM promotions WHERE code = ?',
        [code.toUpperCase()]
    );
}

/**
 * Get promotion by ID
 */
export async function getPromotion(
    env: Env,
    promoId: string
): Promise<Promotion | null> {
    return queryOne<Promotion>(
        env.TATTLEHASH_DB,
        'SELECT * FROM promotions WHERE id = ?',
        [promoId]
    );
}

/**
 * List all promotions (admin)
 */
export async function listPromotions(
    env: Env,
    options?: {
        status?: string;
        limit?: number;
        offset?: number;
    }
): Promise<Promotion[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    if (options?.status) {
        return query<Promotion>(
            env.TATTLEHASH_DB,
            `SELECT * FROM promotions WHERE status = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [options.status, limit, offset]
        );
    }

    return query<Promotion>(
        env.TATTLEHASH_DB,
        `SELECT * FROM promotions ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

// ============================================================================
// User: Claim Promotion
// ============================================================================

/**
 * Claim a promotion code
 */
export async function claimPromotion(
    env: Env,
    userId: string,
    promoCode: string
): Promise<{ ok: true; credits_granted: number } | { ok: false; error: string }> {
    const promo = await getPromotionByCode(env, promoCode);

    if (!promo) {
        return { ok: false, error: 'Invalid promotion code' };
    }

    // Check status
    if (promo.status !== 'ACTIVE') {
        return { ok: false, error: 'Promotion is no longer active' };
    }

    // Check date validity
    const now = Date.now();
    if (promo.starts_at > now) {
        return { ok: false, error: 'Promotion has not started yet' };
    }
    if (promo.ends_at && promo.ends_at < now) {
        return { ok: false, error: 'Promotion has ended' };
    }

    // Check max claims
    if (promo.max_claims && promo.claims_count >= promo.max_claims) {
        return { ok: false, error: 'Promotion limit reached' };
    }

    // Check user hasn't exceeded per-user limit
    const userClaims = await queryOne<{ count: number }>(
        env.TATTLEHASH_DB,
        `SELECT COUNT(*) as count FROM promotion_claims
         WHERE promotion_id = ? AND user_id = ?`,
        [promo.id, userId]
    );

    if ((userClaims?.count ?? 0) >= promo.max_claims_per_user) {
        return { ok: false, error: 'You have already claimed this promotion' };
    }

    // Check new users only
    if (promo.new_users_only) {
        const userCredits = await getOrCreateUserCredits(env, userId);
        if (userCredits.lifetime_transactions > 0) {
            return { ok: false, error: 'This promotion is for new users only' };
        }
    }

    // Check minimum tier
    if (promo.min_tier) {
        const userCredits = await getOrCreateUserCredits(env, userId);
        if (!meetsMinTier(userCredits.loyalty_tier as LoyaltyTier, promo.min_tier as LoyaltyTier)) {
            return {
                ok: false,
                error: `This promotion requires ${promo.min_tier} tier or higher`,
            };
        }
    }

    // Grant credits
    const expiresAt = now + (promo.expiry_days * 24 * 60 * 60 * 1000);
    const creditBalance = await grantCredits(env, {
        userId,
        creditType: 'PROMO',
        amount: promo.credits_granted,
        sourceType: 'PROMO_CODE',
        sourceId: promo.id,
        description: `Promotion: ${promo.name}`,
        expiresAt,
    });

    // Record claim
    const claimId = crypto.randomUUID();
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO promotion_claims (
            id, promotion_id, user_id, credits_granted,
            credit_balance_id, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [claimId, promo.id, userId, promo.credits_granted, creditBalance.id, now]
    );

    // Increment claims count
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE promotions SET claims_count = claims_count + 1, updated_at = ? WHERE id = ?`,
        [now, promo.id]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'promotion_claimed',
        promo_id: promo.id,
        code: promo.code,
        user_id: userId,
        credits: promo.credits_granted,
    }));

    return { ok: true, credits_granted: promo.credits_granted };
}

/**
 * Get user's promotion claim history
 */
export async function getUserPromotionClaims(
    env: Env,
    userId: string
): Promise<Array<{
    promo_code: string;
    promo_name: string;
    credits_granted: number;
    claimed_at: number;
}>> {
    const claims = await query<PromotionClaim & { code: string; name: string }>(
        env.TATTLEHASH_DB,
        `SELECT pc.*, p.code, p.name FROM promotion_claims pc
         JOIN promotions p ON pc.promotion_id = p.id
         WHERE pc.user_id = ?
         ORDER BY pc.claimed_at DESC`,
        [userId]
    );

    return claims.map(c => ({
        promo_code: c.code,
        promo_name: c.name,
        credits_granted: c.credits_granted,
        claimed_at: c.claimed_at,
    }));
}

// ============================================================================
// Expiration
// ============================================================================

/**
 * Expire ended promotions (called by cron)
 */
export async function expirePromotions(env: Env): Promise<number> {
    const now = Date.now();

    // Count before updating
    const toExpire = await query<{ id: string }>(
        env.TATTLEHASH_DB,
        `SELECT id FROM promotions
         WHERE status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at <= ?`,
        [now]
    );

    if (toExpire.length === 0) return 0;

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE promotions SET status = 'EXPIRED', updated_at = ?
         WHERE status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at <= ?`,
        [now, now]
    );

    return toExpire.length;
}

// ============================================================================
// Helpers
// ============================================================================

const TIER_ORDER: LoyaltyTier[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

function meetsMinTier(userTier: LoyaltyTier, minTier: LoyaltyTier): boolean {
    return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(minTier);
}
