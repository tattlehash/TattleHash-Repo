
import { execute, queryOne } from '../../db';
import { createError } from '../../errors';
import { validateTransition } from './transitions';
import { getChallengeById } from './create';
import { runGatekeeperVerification } from './verification';
import { emitEvent } from '../../relay';
import { markCounterpartyAccepted, getCoinToss } from '../../coin-toss';
import { sendFireNotification, generateAcceptToken, generateDownloadToken } from '../../email';
import type { Challenge, ChallengeStatus, AcceptChallengeInput } from './types';
import { Env } from '../../types';

export async function sendChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (challenge.creator_user_id !== userId) {
        throw createError('FORBIDDEN');
    }

    await transitionStatus(env, challenge, 'AWAITING_COUNTERPARTY');

    // For Fire mode with counterparty email, send notification
    if (challenge.mode === 'FIRE' && challenge.counterparty_email) {
        await sendFireModeNotification(env, challenge, userId);
    }

    const updated = await getChallengeById(env, challengeId);
    return updated!;
}

/**
 * Send Fire mode email notification to counterparty
 */
async function sendFireModeNotification(
    env: Env,
    challenge: Challenge,
    creatorUserId: string
): Promise<void> {
    // Get creator's email/name for display
    const creator = await queryOne<{ email: string; display_name?: string }>(
        env.TATTLEHASH_DB,
        'SELECT email, display_name FROM users WHERE id = ?',
        [creatorUserId]
    );

    const initiatorName = creator?.display_name || creator?.email || 'Someone';

    // Generate secure accept token
    const acceptToken = await generateAcceptToken(env, challenge.id, challenge.counterparty_email!);

    // Generate download token if challenge has content
    let downloadUrl: string | undefined;
    if (challenge.content_hash) {
        const downloadToken = await generateDownloadToken(env, challenge.id);
        downloadUrl = `https://api.tattlehash.com/challenges/${challenge.id}/download?token=${downloadToken}`;
    }

    // Send the notification email
    const result = await sendFireNotification(env, {
        counterpartyEmail: challenge.counterparty_email!,
        challengeId: challenge.id,
        title: challenge.title,
        description: challenge.description,
        customNote: challenge.custom_note,
        initiatorName,
        acceptToken,
        expiresAt: challenge.expires_at,
        includeDownloadLink: !!challenge.content_hash,
        downloadUrl,
    });

    if (!result.ok) {
        console.error(JSON.stringify({
            t: Date.now(),
            at: 'fire_notification_failed',
            challenge_id: challenge.id,
            error: result.error,
        }));
        // Don't throw - the challenge was still sent, email delivery is best-effort
    }
}

export async function acceptChallenge(
    env: Env,
    challengeId: string,
    input: AcceptChallengeInput,
    userId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    // Verify this user is the designated counterparty
    if (challenge.counterparty_user_id && challenge.counterparty_user_id !== userId) {
        throw createError('FORBIDDEN', { message: 'Not the designated counterparty' });
    }

    // Check expiry
    if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
        await transitionStatus(env, challenge, 'EXPIRED');
        throw createError('CHALLENGE_EXPIRED');
    }

    // Mark coin toss as accepted if this challenge uses coin toss fee arrangement
    if (challenge.fee_arrangement === 'coin_toss') {
        await markCounterpartyAccepted(env, challengeId);
    }

    await transitionStatus(env, challenge, 'AWAITING_GATEKEEPER');

    // For Gatekeeper mode, automatically start verification
    if (challenge.mode === 'GATEKEEPER') {
        return await runVerificationPhase(env, challengeId);
    }

    const updated = await getChallengeById(env, challengeId);
    return updated!;
}

export async function runVerificationPhase(
    env: Env,
    challengeId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge || challenge.status !== 'AWAITING_GATEKEEPER') {
        throw createError('VALIDATION_ERROR', { message: 'Invalid status for verification' });
    }

    // Run verification for both parties
    const result = await runGatekeeperVerification(env, challenge);

    if (result.allPassed) {
        // All checks passed - lock intent
        await transitionStatus(env, challenge, 'INTENT_LOCKED');
    } else {
        // Verification failed - cancel
        await transitionStatus(env, challenge, 'CANCELLED');
    }

    const updated = await getChallengeById(env, challengeId);
    return updated!;
}

export async function completeChallenge(
    env: Env,
    challengeId: string,
    userId: string
): Promise<Challenge> {
    const challenge = await getChallengeById(env, challengeId);

    if (!challenge) {
        throw createError('CHALLENGE_NOT_FOUND');
    }

    if (!['INTENT_LOCKED', 'AWAITING_RESOLUTION'].includes(challenge.status)) {
        throw createError('VALIDATION_ERROR', { message: 'Invalid status for completion' });
    }

    // Record this user's completion
    await recordUserCompletion(env, challengeId, userId);

    // Check if both parties have completed
    const completions = await getCompletions(env, challengeId);
    const creatorCompleted = completions.some(c => c.user_id === challenge.creator_user_id);
    const counterpartyCompleted = completions.some(c => c.user_id === challenge.counterparty_user_id);

    if (creatorCompleted && counterpartyCompleted) {
        // Both done - finalize
        await transitionStatus(env, challenge, 'COMPLETED');
    } else {
        // Waiting for other party
        if (challenge.status === 'INTENT_LOCKED') {
            await transitionStatus(env, challenge, 'AWAITING_RESOLUTION');
        }
    }

    const updated = await getChallengeById(env, challengeId);
    return updated!;
}

async function transitionStatus(
    env: Env,
    challenge: Challenge,
    newStatus: ChallengeStatus
): Promise<void> {
    const validation = validateTransition(challenge, newStatus);

    if (!validation.valid) {
        throw createError('VALIDATION_ERROR', { message: validation.error });
    }

    const updates: Record<string, unknown> = {
        status: newStatus,
        updated_at: Date.now(),
    };

    // Set timestamps based on status
    if (newStatus === 'INTENT_LOCKED') {
        updates.intent_locked_at = Date.now();
    } else if (newStatus === 'COMPLETED') {
        updates.resolved_at = Date.now();
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), challenge.id];

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE challenges SET ${setClauses} WHERE id = ?`,
        values
    );

    // Emit event
    await emitEvent(env, {
        type: 'challenge.updated',
        challenge_id: challenge.id,
        status: newStatus,
        previous_status: challenge.status,
        updated_at: Date.now()
    });
}

async function recordUserCompletion(
    env: Env,
    challengeId: string,
    userId: string
): Promise<void> {
    const key = `completion:${challengeId}:${userId}`;
    await env.GATE_KV.put(key, JSON.stringify({
        user_id: userId,
        completed_at: Date.now(),
    }), { expirationTtl: 86400 * 30 }); // 30 days
}

async function getCompletions(
    env: Env,
    challengeId: string
): Promise<Array<{ user_id: string; completed_at: number }>> {
    const { keys } = await env.GATE_KV.list({ prefix: `completion:${challengeId}:` });

    const completions = await Promise.all(
        keys.map(async ({ name }) => {
            const data = await env.GATE_KV.get(name, 'json');
            return data as { user_id: string; completed_at: number } | null;
        })
    );

    return completions.filter((c): c is { user_id: string; completed_at: number } => c !== null);
}
