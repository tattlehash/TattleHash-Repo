/**
 * Loyalty System
 *
 * Manages loyalty tiers and milestone achievements.
 *
 * Tiers:
 * - Bronze: 0+ transactions, 0% credit back
 * - Silver: 25+ transactions, 2% credit back
 * - Gold: 100+ transactions, 5% credit back
 * - Platinum: 500+ transactions, 10% credit back
 *
 * Milestones:
 * - 25 transactions: 2 credits
 * - 50 transactions: 3 credits
 * - 100 transactions: 5 credits
 * - 250 transactions: 10 credits
 * - 500 transactions: 20 credits
 * - 1000 transactions: 50 credits
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type { CreditMilestone, UserMilestone, LoyaltyTierConfig } from '../db/types';
import { LOYALTY_TIERS, MILESTONES, LoyaltyTier, CREDIT_DEFAULTS } from './types';
import { grantCredits, getOrCreateUserCredits } from './core';
import { grantFirstTransactionCoupons, processReferralConversion } from './referrals';

// ============================================================================
// Transaction Processing
// ============================================================================

/**
 * Process a completed transaction for loyalty rewards
 * Called after any paid transaction completes
 */
export async function processTransactionCompletion(
    env: Env,
    userId: string,
    transactionValue?: number // Optional: for percentage-based rewards
): Promise<{
    new_tier?: LoyaltyTier;
    milestones_achieved: string[];
    credits_earned: number;
    referral_coupons_granted: number;
}> {
    const now = Date.now();
    let creditsEarned = 0;
    const milestonesAchieved: string[] = [];

    // Increment lifetime transactions
    await execute(
        env.TATTLEHASH_DB,
        `UPDATE user_credits SET
            lifetime_transactions = lifetime_transactions + 1,
            updated_at = ?
         WHERE user_id = ?`,
        [now, userId]
    );

    const userCredits = await getOrCreateUserCredits(env, userId);
    const txCount = userCredits.lifetime_transactions;

    // Process first transaction bonuses
    let couponsGranted = 0;
    if (txCount === 1) {
        const couponResult = await grantFirstTransactionCoupons(env, userId);
        couponsGranted = couponResult.coupons_granted;

        // Also process referral conversion (reward the referrer)
        await processReferralConversion(env, userId);
    }

    // Check for tier upgrade
    const newTier = await checkAndUpgradeTier(env, userId, txCount);

    // Check for milestone achievements
    const milestoneCredits = await checkMilestones(env, userId, txCount);
    creditsEarned += milestoneCredits.credits;
    milestonesAchieved.push(...milestoneCredits.milestones);

    // Apply loyalty cashback if applicable
    if (transactionValue && transactionValue > 0) {
        const tierConfig = LOYALTY_TIERS[userCredits.loyalty_tier as keyof typeof LOYALTY_TIERS];
        if (tierConfig.credit_back_percent > 0) {
            // Calculate credits (1 credit = 1 transaction, so we round)
            const cashbackCredits = Math.floor(transactionValue * tierConfig.credit_back_percent);
            if (cashbackCredits > 0) {
                await grantCredits(env, {
                    userId,
                    creditType: 'LOYALTY',
                    amount: cashbackCredits,
                    sourceType: 'LOYALTY_CASHBACK',
                    description: `${tierConfig.credit_back_percent * 100}% loyalty cashback`,
                    expiresAt: now + CREDIT_DEFAULTS.LOYALTY_CREDIT_EXPIRY_MS,
                });
                creditsEarned += cashbackCredits;
            }
        }
    }

    console.log(JSON.stringify({
        t: now,
        at: 'transaction_processed_for_loyalty',
        user_id: userId,
        tx_count: txCount,
        new_tier: newTier,
        milestones: milestonesAchieved,
        credits_earned: creditsEarned,
    }));

    return {
        new_tier: newTier,
        milestones_achieved: milestonesAchieved,
        credits_earned: creditsEarned,
        referral_coupons_granted: couponsGranted,
    };
}

// ============================================================================
// Tier Management
// ============================================================================

/**
 * Check if user qualifies for tier upgrade
 */
async function checkAndUpgradeTier(
    env: Env,
    userId: string,
    txCount: number
): Promise<LoyaltyTier | undefined> {
    const userCredits = await getOrCreateUserCredits(env, userId);
    const currentTier = userCredits.loyalty_tier as LoyaltyTier;

    // Determine new tier based on transaction count
    let newTier: LoyaltyTier = 'BRONZE';
    if (txCount >= LOYALTY_TIERS.PLATINUM.min_transactions) {
        newTier = 'PLATINUM';
    } else if (txCount >= LOYALTY_TIERS.GOLD.min_transactions) {
        newTier = 'GOLD';
    } else if (txCount >= LOYALTY_TIERS.SILVER.min_transactions) {
        newTier = 'SILVER';
    }

    if (newTier !== currentTier) {
        const now = Date.now();

        await execute(
            env.TATTLEHASH_DB,
            `UPDATE user_credits SET loyalty_tier = ?, updated_at = ? WHERE user_id = ?`,
            [newTier, now, userId]
        );

        console.log(JSON.stringify({
            t: now,
            at: 'tier_upgraded',
            user_id: userId,
            from_tier: currentTier,
            to_tier: newTier,
        }));

        return newTier;
    }

    return undefined;
}

/**
 * Get loyalty tier configuration
 */
export async function getLoyaltyTierConfig(
    env: Env,
    tier: LoyaltyTier
): Promise<LoyaltyTierConfig | null> {
    return queryOne<LoyaltyTierConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM loyalty_tiers WHERE tier = ?',
        [tier]
    );
}

/**
 * Get all loyalty tier configurations
 */
export async function getAllLoyaltyTiers(env: Env): Promise<LoyaltyTierConfig[]> {
    return query<LoyaltyTierConfig>(
        env.TATTLEHASH_DB,
        'SELECT * FROM loyalty_tiers ORDER BY min_transactions ASC',
        []
    );
}

// ============================================================================
// Milestone Management
// ============================================================================

/**
 * Check and grant milestone rewards
 */
async function checkMilestones(
    env: Env,
    userId: string,
    txCount: number
): Promise<{ credits: number; milestones: string[] }> {
    let totalCredits = 0;
    const achievedMilestones: string[] = [];

    // Get all milestones user hasn't achieved yet
    const allMilestones = await query<CreditMilestone>(
        env.TATTLEHASH_DB,
        `SELECT m.* FROM credit_milestones m
         WHERE m.active = 1
         AND NOT EXISTS (
             SELECT 1 FROM user_milestones um
             WHERE um.user_id = ? AND um.milestone_id = m.id
         )
         ORDER BY m.transaction_count ASC`,
        [userId]
    );

    for (const milestone of allMilestones) {
        if (txCount >= milestone.transaction_count) {
            // Grant milestone credits
            const creditBalance = await grantCredits(env, {
                userId,
                creditType: 'MILESTONE',
                amount: milestone.credits_awarded,
                sourceType: 'MILESTONE',
                sourceId: milestone.id,
                description: `Milestone: ${milestone.name}`,
            });

            // Record achievement
            await execute(
                env.TATTLEHASH_DB,
                `INSERT INTO user_milestones (
                    id, user_id, milestone_id, achieved_at,
                    credits_awarded, credit_balance_id
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    crypto.randomUUID(),
                    userId,
                    milestone.id,
                    Date.now(),
                    milestone.credits_awarded,
                    creditBalance.id,
                ]
            );

            totalCredits += milestone.credits_awarded;
            achievedMilestones.push(milestone.name);

            console.log(JSON.stringify({
                t: Date.now(),
                at: 'milestone_achieved',
                user_id: userId,
                milestone: milestone.name,
                credits: milestone.credits_awarded,
            }));
        }
    }

    return { credits: totalCredits, milestones: achievedMilestones };
}

/**
 * Get user's milestone progress
 */
export async function getMilestoneProgress(
    env: Env,
    userId: string
): Promise<{
    achieved: Array<{
        name: string;
        achieved_at: number;
        credits_awarded: number;
    }>;
    upcoming: Array<{
        name: string;
        transaction_count: number;
        credits_awarded: number;
        transactions_remaining: number;
    }>;
}> {
    const userCredits = await getOrCreateUserCredits(env, userId);
    const txCount = userCredits.lifetime_transactions;

    // Get achieved milestones
    const achieved = await query<UserMilestone & { name: string }>(
        env.TATTLEHASH_DB,
        `SELECT um.*, m.name FROM user_milestones um
         JOIN credit_milestones m ON um.milestone_id = m.id
         WHERE um.user_id = ?
         ORDER BY um.achieved_at DESC`,
        [userId]
    );

    // Get upcoming milestones
    const upcoming = await query<CreditMilestone>(
        env.TATTLEHASH_DB,
        `SELECT m.* FROM credit_milestones m
         WHERE m.active = 1
         AND NOT EXISTS (
             SELECT 1 FROM user_milestones um
             WHERE um.user_id = ? AND um.milestone_id = m.id
         )
         ORDER BY m.transaction_count ASC
         LIMIT 5`,
        [userId]
    );

    return {
        achieved: achieved.map(a => ({
            name: a.name,
            achieved_at: a.achieved_at,
            credits_awarded: a.credits_awarded,
        })),
        upcoming: upcoming.map(u => ({
            name: u.name,
            transaction_count: u.transaction_count,
            credits_awarded: u.credits_awarded,
            transactions_remaining: u.transaction_count - txCount,
        })),
    };
}

// ============================================================================
// Leaderboard / Stats
// ============================================================================

/**
 * Get top users by lifetime transactions
 */
export async function getLeaderboard(
    env: Env,
    limit = 10
): Promise<Array<{
    user_id: string;
    loyalty_tier: string;
    lifetime_transactions: number;
    referral_conversions: number;
}>> {
    return query(
        env.TATTLEHASH_DB,
        `SELECT user_id, loyalty_tier, lifetime_transactions, referral_conversions
         FROM user_credits
         ORDER BY lifetime_transactions DESC
         LIMIT ?`,
        [limit]
    );
}

/**
 * Get tier distribution stats
 */
export async function getTierDistribution(
    env: Env
): Promise<Record<LoyaltyTier, number>> {
    const results = await query<{ loyalty_tier: string; count: number }>(
        env.TATTLEHASH_DB,
        `SELECT loyalty_tier, COUNT(*) as count
         FROM user_credits
         GROUP BY loyalty_tier`,
        []
    );

    const distribution: Record<LoyaltyTier, number> = {
        BRONZE: 0,
        SILVER: 0,
        GOLD: 0,
        PLATINUM: 0,
    };

    for (const row of results) {
        distribution[row.loyalty_tier as LoyaltyTier] = row.count;
    }

    return distribution;
}
