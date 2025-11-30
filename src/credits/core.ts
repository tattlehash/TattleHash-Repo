/**
 * Credits Core Module
 *
 * Handles credit granting, redemption, balance tracking, and expiration.
 * The credit_balances table is the source of truth for individual grants.
 * The user_credits table caches aggregated values for fast lookups.
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type {
    UserCredits,
    CreditBalance,
    CreditEvent,
    CreditHold,
} from '../db/types';
import {
    CREDIT_DEFAULTS,
    LOYALTY_TIERS,
    CreditType,
    CreditSourceType,
    CreditSummary,
    CreditHistoryItem,
    LoyaltyTier,
} from './types';

// ============================================================================
// User Credits Management
// ============================================================================

/**
 * Get or create user credits record
 */
export async function getOrCreateUserCredits(
    env: Env,
    userId: string
): Promise<UserCredits> {
    let credits = await queryOne<UserCredits>(
        env.TATTLEHASH_DB,
        'SELECT * FROM user_credits WHERE user_id = ?',
        [userId]
    );

    if (!credits) {
        const referralCode = generateReferralCode();
        const now = Date.now();

        await execute(
            env.TATTLEHASH_DB,
            `INSERT INTO user_credits (
                user_id, total_available, total_pending, loyalty_tier,
                lifetime_transactions, lifetime_credits_earned, lifetime_credits_used,
                referral_code, referral_coupons_available, referral_coupons_sent,
                referral_conversions, created_at, updated_at
            ) VALUES (?, 0, 0, 'BRONZE', 0, 0, 0, ?, 0, 0, 0, ?, ?)`,
            [userId, referralCode, now, now]
        );

        credits = await queryOne<UserCredits>(
            env.TATTLEHASH_DB,
            'SELECT * FROM user_credits WHERE user_id = ?',
            [userId]
        );
    }

    return credits!;
}

/**
 * Get credit summary for a user
 */
export async function getCreditSummary(
    env: Env,
    userId: string
): Promise<CreditSummary> {
    const credits = await getOrCreateUserCredits(env, userId);
    const tier = LOYALTY_TIERS[credits.loyalty_tier as keyof typeof LOYALTY_TIERS];

    // Get expiring soon (within 7 days)
    const expiringBalances = await query<CreditBalance>(
        env.TATTLEHASH_DB,
        `SELECT expires_at, remaining FROM credit_balances
         WHERE user_id = ? AND status = 'ACTIVE' AND remaining > 0
         AND expires_at <= ?
         ORDER BY expires_at ASC
         LIMIT 5`,
        [userId, Date.now() + 7 * 24 * 60 * 60 * 1000]
    );

    // Calculate next tier
    let nextTier: CreditSummary['next_tier'];
    const tierOrder: LoyaltyTier[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const currentTierIndex = tierOrder.indexOf(credits.loyalty_tier as LoyaltyTier);

    if (currentTierIndex < tierOrder.length - 1) {
        const next = tierOrder[currentTierIndex + 1];
        const nextConfig = LOYALTY_TIERS[next];
        nextTier = {
            tier: next,
            transactions_needed: nextConfig.min_transactions - credits.lifetime_transactions,
        };
    }

    return {
        total_available: credits.total_available,
        total_pending: credits.total_pending,
        loyalty_tier: credits.loyalty_tier,
        tier_display_name: tier.display_name,
        tier_credit_back_percent: tier.credit_back_percent,
        lifetime_transactions: credits.lifetime_transactions,
        lifetime_credits_earned: credits.lifetime_credits_earned,
        lifetime_credits_used: credits.lifetime_credits_used,
        next_tier: nextTier,
        referral_code: credits.referral_code,
        referral_coupons_available: credits.referral_coupons_available,
        referral_conversions: credits.referral_conversions,
        expiring_soon: expiringBalances.map(b => ({
            amount: b.remaining,
            expires_at: b.expires_at,
        })),
    };
}

/**
 * Get credit history for a user
 */
export async function getCreditHistory(
    env: Env,
    userId: string,
    limit = 20
): Promise<CreditHistoryItem[]> {
    const events = await query<CreditEvent>(
        env.TATTLEHASH_DB,
        `SELECT event_type, amount, description, balance_after, created_at
         FROM credit_events
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [userId, limit]
    );

    return events.map(e => ({
        event_type: e.event_type,
        amount: e.amount,
        description: e.description,
        balance_after: e.balance_after,
        created_at: e.created_at,
    }));
}

// ============================================================================
// Credit Granting
// ============================================================================

export interface GrantCreditsInput {
    userId: string;
    creditType: CreditType;
    amount: number;
    sourceType: CreditSourceType;
    sourceId?: string;
    description: string;
    expiresAt?: number;
}

/**
 * Grant credits to a user
 */
export async function grantCredits(
    env: Env,
    input: GrantCreditsInput
): Promise<CreditBalance> {
    const balanceId = crypto.randomUUID();
    const now = Date.now();

    // Determine expiration based on credit type
    const expiresAt = input.expiresAt ?? getDefaultExpiration(input.creditType);

    // Get current balance
    const userCredits = await getOrCreateUserCredits(env, input.userId);
    const balanceBefore = userCredits.total_available;
    const balanceAfter = balanceBefore + input.amount;

    // Create credit balance
    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO credit_balances (
            id, user_id, credit_type, amount, remaining, source_type,
            source_id, source_description, expires_at, status, granted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [
            balanceId,
            input.userId,
            input.creditType,
            input.amount,
            input.amount,
            input.sourceType,
            input.sourceId ?? null,
            input.description,
            expiresAt,
            now,
        ]
    );

    // Log event
    await logCreditEvent(env, {
        userId: input.userId,
        eventType: 'GRANT',
        creditType: input.creditType,
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        creditBalanceId: balanceId,
        description: input.description,
    });

    // Update cached balance
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_available = total_available + ?,
            lifetime_credits_earned = lifetime_credits_earned + ?,
            updated_at = ?
         WHERE user_id = ?`,
        [input.amount, input.amount, now, input.userId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'credits_granted',
        user_id: input.userId,
        amount: input.amount,
        credit_type: input.creditType,
        source_type: input.sourceType,
    }));

    return {
        id: balanceId,
        user_id: input.userId,
        credit_type: input.creditType,
        amount: input.amount,
        remaining: input.amount,
        source_type: input.sourceType,
        source_id: input.sourceId,
        source_description: input.description,
        expires_at: expiresAt,
        status: 'ACTIVE',
        granted_at: now,
    };
}

// ============================================================================
// Credit Redemption
// ============================================================================

export interface RedeemCreditsResult {
    success: boolean;
    amount_redeemed: number;
    balances_used: Array<{
        balance_id: string;
        amount_used: number;
    }>;
    remaining_balance: number;
}

/**
 * Redeem credits for a transaction (FIFO by expiration)
 */
export async function redeemCredits(
    env: Env,
    userId: string,
    amount: number,
    transactionId?: string
): Promise<RedeemCreditsResult> {
    const userCredits = await getOrCreateUserCredits(env, userId);

    if (userCredits.total_available < amount) {
        return {
            success: false,
            amount_redeemed: 0,
            balances_used: [],
            remaining_balance: userCredits.total_available,
        };
    }

    // Get active balances ordered by expiration (FIFO)
    const balances = await query<CreditBalance>(
        env.TATTLEHASH_DB,
        `SELECT * FROM credit_balances
         WHERE user_id = ? AND status = 'ACTIVE' AND remaining > 0
         ORDER BY expires_at ASC`,
        [userId]
    );

    let remainingToRedeem = amount;
    const balancesUsed: Array<{ balance_id: string; amount_used: number }> = [];
    const now = Date.now();

    for (const balance of balances) {
        if (remainingToRedeem <= 0) break;

        const useAmount = Math.min(remainingToRedeem, balance.remaining);
        const newRemaining = balance.remaining - useAmount;

        await execute(
            env.TATTLEHASH_DB,
            `UPDATE credit_balances SET
                remaining = ?,
                status = CASE WHEN ? = 0 THEN 'EXHAUSTED' ELSE status END,
                exhausted_at = CASE WHEN ? = 0 THEN ? ELSE exhausted_at END
             WHERE id = ?`,
            [newRemaining, newRemaining, newRemaining, now, balance.id]
        );

        balancesUsed.push({
            balance_id: balance.id,
            amount_used: useAmount,
        });

        remainingToRedeem -= useAmount;
    }

    const balanceBefore = userCredits.total_available;
    const balanceAfter = balanceBefore - amount;

    // Log event
    await logCreditEvent(env, {
        userId,
        eventType: 'REDEEM',
        amount: -amount,
        balanceBefore,
        balanceAfter,
        transactionId,
        description: `Redeemed ${amount} credit(s) for transaction`,
        metadata: { balances_used: balancesUsed },
    });

    // Update cached balance
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_available = total_available - ?,
            lifetime_credits_used = lifetime_credits_used + ?,
            updated_at = ?
         WHERE user_id = ?`,
        [amount, amount, now, userId]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'credits_redeemed',
        user_id: userId,
        amount,
        transaction_id: transactionId,
    }));

    return {
        success: true,
        amount_redeemed: amount,
        balances_used: balancesUsed,
        remaining_balance: balanceAfter,
    };
}

// ============================================================================
// Credit Holds (for pending transactions)
// ============================================================================

/**
 * Place a hold on credits for a pending transaction
 */
export async function holdCredits(
    env: Env,
    userId: string,
    amount: number,
    reason: string,
    transactionId?: string,
    challengeId?: string
): Promise<CreditHold | null> {
    const userCredits = await getOrCreateUserCredits(env, userId);

    if (userCredits.total_available < amount) {
        return null;
    }

    const holdId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + CREDIT_DEFAULTS.HOLD_EXPIRY_MS;

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO credit_holds (
            id, user_id, amount, reason, transaction_id, challenge_id,
            status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?, ?)`,
        [holdId, userId, amount, reason, transactionId ?? null, challengeId ?? null, now, expiresAt]
    );

    // Update cached pending balance
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_available = total_available - ?,
            total_pending = total_pending + ?,
            updated_at = ?
         WHERE user_id = ?`,
        [amount, amount, now, userId]
    );

    const balanceBefore = userCredits.total_available;
    await logCreditEvent(env, {
        userId,
        eventType: 'HOLD',
        amount: -amount,
        balanceBefore,
        balanceAfter: balanceBefore - amount,
        transactionId,
        description: `Held ${amount} credit(s): ${reason}`,
    });

    return {
        id: holdId,
        user_id: userId,
        amount,
        reason,
        transaction_id: transactionId,
        challenge_id: challengeId,
        status: 'HELD',
        created_at: now,
        expires_at: expiresAt,
    };
}

/**
 * Release held credits back to available
 */
export async function releaseHold(
    env: Env,
    holdId: string
): Promise<boolean> {
    const hold = await queryOne<CreditHold>(
        env.TATTLEHASH_DB,
        'SELECT * FROM credit_holds WHERE id = ? AND status = ?',
        [holdId, 'HELD']
    );

    if (!hold) return false;

    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE credit_holds SET
            status = 'RELEASED',
            resolved_at = ?,
            resolution_type = 'RELEASED'
         WHERE id = ?`,
        [now, holdId]
    );

    // Return credits to available
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_available = total_available + ?,
            total_pending = total_pending - ?,
            updated_at = ?
         WHERE user_id = ?`,
        [hold.amount, hold.amount, now, hold.user_id]
    );

    const userCredits = await getOrCreateUserCredits(env, hold.user_id);
    await logCreditEvent(env, {
        userId: hold.user_id,
        eventType: 'RELEASE',
        amount: hold.amount,
        balanceBefore: userCredits.total_available - hold.amount,
        balanceAfter: userCredits.total_available,
        transactionId: hold.transaction_id,
        description: `Released ${hold.amount} held credit(s)`,
    });

    return true;
}

/**
 * Apply held credits (mark as used)
 */
export async function applyHold(
    env: Env,
    holdId: string,
    transactionId?: string
): Promise<boolean> {
    const hold = await queryOne<CreditHold>(
        env.TATTLEHASH_DB,
        'SELECT * FROM credit_holds WHERE id = ? AND status = ?',
        [holdId, 'HELD']
    );

    if (!hold) return false;

    const now = Date.now();

    // Get active balances to deduct from
    const balances = await query<CreditBalance>(
        env.TATTLEHASH_DB,
        `SELECT * FROM credit_balances
         WHERE user_id = ? AND status = 'ACTIVE' AND remaining > 0
         ORDER BY expires_at ASC`,
        [hold.user_id]
    );

    let remainingToDeduct = hold.amount;
    for (const balance of balances) {
        if (remainingToDeduct <= 0) break;

        const deductAmount = Math.min(remainingToDeduct, balance.remaining);
        const newRemaining = balance.remaining - deductAmount;

        await execute(
            env.TATTLEHASH_DB,
            `UPDATE credit_balances SET
                remaining = ?,
                status = CASE WHEN ? = 0 THEN 'EXHAUSTED' ELSE status END,
                exhausted_at = CASE WHEN ? = 0 THEN ? ELSE exhausted_at END
             WHERE id = ?`,
            [newRemaining, newRemaining, newRemaining, now, balance.id]
        );

        remainingToDeduct -= deductAmount;
    }

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE credit_holds SET
            status = 'APPLIED',
            resolved_at = ?,
            resolution_type = 'APPLIED'
         WHERE id = ?`,
        [now, holdId]
    );

    // Update user credits
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_pending = total_pending - ?,
            lifetime_credits_used = lifetime_credits_used + ?,
            updated_at = ?
         WHERE user_id = ?`,
        [hold.amount, hold.amount, now, hold.user_id]
    );

    return true;
}

// ============================================================================
// Expiration Processing
// ============================================================================

/**
 * Expire stale credit balances (called by cron)
 */
export async function expireCredits(env: Env): Promise<number> {
    const now = Date.now();

    // Find expired balances
    const expired = await query<CreditBalance>(
        env.TATTLEHASH_DB,
        `SELECT * FROM credit_balances
         WHERE status = 'ACTIVE' AND remaining > 0 AND expires_at <= ?`,
        [now]
    );

    if (expired.length === 0) return 0;

    // Group by user
    const byUser = new Map<string, CreditBalance[]>();
    for (const balance of expired) {
        const list = byUser.get(balance.user_id) ?? [];
        list.push(balance);
        byUser.set(balance.user_id, list);
    }

    // Process each user
    for (const [userId, balances] of byUser) {
        let totalExpired = 0;

        for (const balance of balances) {
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE credit_balances SET status = 'EXPIRED' WHERE id = ?`,
                [balance.id]
            );
            totalExpired += balance.remaining;
        }

        // Update user's available balance
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE user_credits SET
                total_available = total_available - ?,
                updated_at = ?
             WHERE user_id = ?`,
            [totalExpired, now, userId]
        );

        const userCredits = await getOrCreateUserCredits(env, userId);
        await logCreditEvent(env, {
            userId,
            eventType: 'EXPIRE',
            amount: -totalExpired,
            balanceBefore: userCredits.total_available + totalExpired,
            balanceAfter: userCredits.total_available,
            description: `${totalExpired} credit(s) expired`,
        });
    }

    console.log(JSON.stringify({
        t: now,
        at: 'credits_expired',
        users_affected: byUser.size,
        balances_expired: expired.length,
    }));

    return expired.length;
}

/**
 * Expire stale credit holds (called by cron)
 */
export async function expireHolds(env: Env): Promise<number> {
    const now = Date.now();

    const expiredHolds = await query<CreditHold>(
        env.TATTLEHASH_DB,
        `SELECT * FROM credit_holds WHERE status = 'HELD' AND expires_at <= ?`,
        [now]
    );

    for (const hold of expiredHolds) {
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE credit_holds SET
                status = 'EXPIRED',
                resolved_at = ?,
                resolution_type = 'EXPIRED'
             WHERE id = ?`,
            [now, hold.id]
        );

        // Return credits to available
        await execute(
            env.TATTLEHASH_DB,
            `UPDATE user_credits SET
                total_available = total_available + ?,
                total_pending = total_pending - ?,
                updated_at = ?
             WHERE user_id = ?`,
            [hold.amount, hold.amount, now, hold.user_id]
        );

        const userCredits = await getOrCreateUserCredits(env, hold.user_id);
        await logCreditEvent(env, {
            userId: hold.user_id,
            eventType: 'RELEASE',
            amount: hold.amount,
            balanceBefore: userCredits.total_available - hold.amount,
            balanceAfter: userCredits.total_available,
            description: `Hold expired, ${hold.amount} credit(s) returned`,
        });
    }

    return expiredHolds.length;
}

// ============================================================================
// Helpers
// ============================================================================

interface LogEventInput {
    userId: string;
    eventType: string;
    creditType?: CreditType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    creditBalanceId?: string;
    transactionId?: string;
    promotionId?: string;
    referralId?: string;
    description: string;
    metadata?: Record<string, unknown>;
}

async function logCreditEvent(env: Env, input: LogEventInput): Promise<void> {
    const eventId = crypto.randomUUID();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO credit_events (
            id, user_id, event_type, credit_type, amount,
            balance_before, balance_after, credit_balance_id,
            transaction_id, promotion_id, referral_id,
            description, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            eventId,
            input.userId,
            input.eventType,
            input.creditType ?? null,
            input.amount,
            input.balanceBefore,
            input.balanceAfter,
            input.creditBalanceId ?? null,
            input.transactionId ?? null,
            input.promotionId ?? null,
            input.referralId ?? null,
            input.description,
            input.metadata ? JSON.stringify(input.metadata) : null,
            Date.now(),
        ]
    );
}

function getDefaultExpiration(creditType: CreditType): number {
    const now = Date.now();
    switch (creditType) {
        case 'PROMO':
            return now + CREDIT_DEFAULTS.PROMO_EXPIRY_MS;
        case 'REFERRAL_REWARD':
            return now + CREDIT_DEFAULTS.REFERRAL_REWARD_EXPIRY_MS;
        case 'LOYALTY':
            return now + CREDIT_DEFAULTS.LOYALTY_CREDIT_EXPIRY_MS;
        case 'MILESTONE':
            return now + CREDIT_DEFAULTS.REFERRAL_REWARD_EXPIRY_MS;
        default:
            return now + CREDIT_DEFAULTS.REFERRAL_REWARD_EXPIRY_MS;
    }
}

function generateReferralCode(): string {
    // Generate an 8-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
    let code = '';
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    for (let i = 0; i < 8; i++) {
        code += chars[array[i] % chars.length];
    }
    return code;
}

/**
 * Recalculate and sync user's cached balance from credit_balances
 */
export async function syncUserBalance(env: Env, userId: string): Promise<void> {
    const result = await queryOne<{ total: number }>(
        env.TATTLEHASH_DB,
        `SELECT COALESCE(SUM(remaining), 0) as total FROM credit_balances
         WHERE user_id = ? AND status = 'ACTIVE' AND remaining > 0`,
        [userId]
    );

    const pendingResult = await queryOne<{ total: number }>(
        env.TATTLEHASH_DB,
        `SELECT COALESCE(SUM(amount), 0) as total FROM credit_holds
         WHERE user_id = ? AND status = 'HELD'`,
        [userId]
    );

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            total_available = ?,
            total_pending = ?,
            updated_at = ?
         WHERE user_id = ?`,
        [result?.total ?? 0, pendingResult?.total ?? 0, Date.now(), userId]
    );
}
