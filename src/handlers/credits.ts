/**
 * Credits & Loyalty API Handlers
 *
 * Endpoints for credit management, referrals, and promotions.
 */

import { ok, err } from '../lib/http';
import { Env } from '../types';
import { authenticateRequest } from '../middleware/auth';
import {
    getCreditSummary,
    getCreditHistory,
    redeemCredits,
    generateReferralCoupon,
    generateReferralLink,
    claimReferralCoupon,
    getReferralStatus,
    claimPromotion,
    createPromotion,
    updatePromotion,
    getPromotion,
    listPromotions,
    getMilestoneProgress,
    getAllLoyaltyTiers,
    GetCreditsSchema,
    RedeemCreditsSchema,
    SendReferralSchema,
    ClaimReferralSchema,
    ClaimPromotionSchema,
    CreatePromotionSchema,
    UpdatePromotionSchema,
} from '../credits';

// ============================================================================
// Credit Management
// ============================================================================

/**
 * GET /credits
 * Get user's credit summary and optionally history
 */
export async function getCreditsHandler(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const url = new URL(req.url);
    const includeHistory = url.searchParams.get('include_history') === 'true';
    const historyLimit = parseInt(url.searchParams.get('history_limit') ?? '20');

    const parsed = GetCreditsSchema.safeParse({
        include_history: includeHistory,
        history_limit: historyLimit,
    });

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const summary = await getCreditSummary(env, userId);

    let history;
    if (parsed.data.include_history) {
        history = await getCreditHistory(env, userId, parsed.data.history_limit);
    }

    return ok({
        ...summary,
        history,
    });
}

/**
 * POST /credits/redeem
 * Redeem credits for a transaction
 */
export async function postRedeemCredits(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;
    const parsed = RedeemCreditsSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const result = await redeemCredits(
        env,
        userId,
        parsed.data.amount,
        parsed.data.transaction_id
    );

    if (!result.success) {
        return err(400, 'INSUFFICIENT_CREDITS', {
            available: result.remaining_balance,
            requested: parsed.data.amount,
        });
    }

    return ok({
        success: true,
        amount_redeemed: result.amount_redeemed,
        remaining_balance: result.remaining_balance,
    });
}

/**
 * GET /credits/milestones
 * Get user's milestone progress
 */
export async function getMilestonesHandler(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const progress = await getMilestoneProgress(env, userId);
    return ok(progress);
}

/**
 * GET /credits/tiers
 * Get all loyalty tier information
 */
export async function getTiersHandler(req: Request, env: Env): Promise<Response> {
    const tiers = await getAllLoyaltyTiers(env);
    return ok({ tiers });
}

// ============================================================================
// Referral Handlers
// ============================================================================

/**
 * POST /referral/send
 * Generate and send a referral coupon
 */
export async function postSendReferral(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;
    const parsed = SendReferralSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const result = await generateReferralCoupon(env, userId, parsed.data.recipient_email);

    if (!result.ok) {
        return err(400, 'REFERRAL_ERROR', { message: result.error });
    }

    // Generate referral link
    const baseUrl = new URL(req.url).origin;
    const referralLink = generateReferralLink(result.coupon.coupon_code, baseUrl);

    return ok({
        coupon_code: result.coupon.coupon_code,
        referral_link: referralLink,
        expires_at: result.coupon.expires_at,
    }, { status: 201 });
}

/**
 * POST /referral/claim
 * Claim a referral coupon (during signup)
 */
export async function postClaimReferral(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;
    const parsed = ClaimReferralSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const result = await claimReferralCoupon(env, parsed.data.coupon_code, userId);

    if (!result.ok) {
        return err(400, 'REFERRAL_ERROR', { message: result.error });
    }

    return ok({
        success: true,
        credits_granted: result.credits_granted,
    });
}

/**
 * GET /referral/status
 * Get user's referral status and pending referrals
 */
export async function getReferralStatusHandler(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const status = await getReferralStatus(env, userId);
    return ok(status);
}

// ============================================================================
// Promotion Handlers
// ============================================================================

/**
 * POST /promotions/claim
 * Claim a promotion code
 */
export async function postClaimPromotion(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }
    const userId = authResult.context.userId;

    const body = await req.json() as Record<string, unknown>;
    const parsed = ClaimPromotionSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const result = await claimPromotion(env, userId, parsed.data.promo_code);

    if (!result.ok) {
        return err(400, 'PROMOTION_ERROR', { message: result.error });
    }

    return ok({
        success: true,
        credits_granted: result.credits_granted,
    });
}

// ============================================================================
// Admin: Promotion Management
// ============================================================================

/**
 * POST /admin/promotions
 * Create a new promotion (admin only)
 * Note: Admin check is done by requireAdmin middleware in router
 */
export async function postCreatePromotion(req: Request, env: Env): Promise<Response> {
    const authResult = await authenticateRequest(req, env);
    if (!authResult.ok) {
        return err(authResult.error.status, authResult.error.code as any, authResult.error.details);
    }

    const userId = authResult.context.userId;
    const body = await req.json() as Record<string, unknown>;
    const parsed = CreatePromotionSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    try {
        const promo = await createPromotion(env, parsed.data, userId);
        return ok(promo, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(400, 'PROMOTION_ERROR', { message });
    }
}

/**
 * GET /admin/promotions
 * List all promotions (admin only)
 * Note: Admin check is done by requireAdmin middleware in router
 */
export async function getListPromotions(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50');
    const offset = parseInt(url.searchParams.get('offset') ?? '0');

    const promotions = await listPromotions(env, { status, limit, offset });

    return ok({
        promotions,
        pagination: { limit, offset, count: promotions.length },
    });
}

/**
 * GET /admin/promotions/:id
 * Get promotion details (admin only)
 * Note: Admin check is done by requireAdmin middleware in router
 */
export async function getPromotionDetails(
    req: Request,
    env: Env,
    promoId: string
): Promise<Response> {
    const promo = await getPromotion(env, promoId);

    if (!promo) {
        return err(404, 'NOT_FOUND', { resource: 'promotion' });
    }

    return ok(promo);
}

/**
 * PATCH /admin/promotions/:id
 * Update a promotion (admin only)
 * Note: Admin check is done by requireAdmin middleware in router
 */
export async function patchUpdatePromotion(
    req: Request,
    env: Env,
    promoId: string
): Promise<Response> {
    const body = await req.json() as Record<string, unknown>;
    const parsed = UpdatePromotionSchema.safeParse(body);

    if (!parsed.success) {
        return err(400, 'VALIDATION_ERROR', { errors: parsed.error.flatten() });
    }

    const updated = await updatePromotion(env, promoId, parsed.data);

    if (!updated) {
        return err(404, 'NOT_FOUND', { resource: 'promotion' });
    }

    return ok(updated);
}
