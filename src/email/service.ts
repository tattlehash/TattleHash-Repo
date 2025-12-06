/**
 * Email Service - Resend Integration
 *
 * Uses Resend API to send transactional emails.
 * https://resend.com/docs/api-reference/emails/send-email
 */

import type { Env } from '../types';
import type { EmailOptions, EmailResult, FireNotificationData, DownloadToken } from './types';
import {
    generateFireNotificationEmail,
    generateLoginCodeEmail,
    generateEmailVerificationEmail,
    generatePasswordResetEmail,
    type LoginCodeEmailData,
    type EmailVerificationData,
    type PasswordResetData,
} from './templates';

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = 'TattleHash <notifications@tattlehash.com>';

/**
 * Send an email via Resend API
 */
export async function sendEmail(
    env: Env,
    options: EmailOptions
): Promise<EmailResult> {
    const apiKey = env.RESEND_API_KEY;

    if (!apiKey) {
        console.error('RESEND_API_KEY not configured');
        return { ok: false, error: 'Email service not configured' };
    }

    try {
        const response = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM_EMAIL,
                to: [options.to],
                subject: options.subject,
                html: options.html,
                text: options.text,
                reply_to: options.replyTo,
                tags: options.tags,
            }),
        });

        const data = await response.json() as { id?: string; message?: string };

        if (!response.ok) {
            console.error('Resend API error:', data);
            return {
                ok: false,
                error: data.message || `HTTP ${response.status}`,
            };
        }

        console.log(JSON.stringify({
            t: Date.now(),
            at: 'email_sent',
            to: options.to,
            subject: options.subject,
            resend_id: data.id,
        }));

        return { ok: true, id: data.id };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Email send failed:', message);
        return { ok: false, error: message };
    }
}

/**
 * Generate a secure download token for 24hr evidence access
 */
export async function generateDownloadToken(
    env: Env,
    challengeId: string
): Promise<string> {
    const token: DownloadToken = {
        challengeId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    // Create a secure token
    const tokenId = crypto.randomUUID();
    const tokenData = JSON.stringify(token);

    // Store in KV with 24hr TTL
    await env.TATTLEHASH_KV.put(
        `download:token:${tokenId}`,
        tokenData,
        { expirationTtl: 86400 } // 24 hours
    );

    return tokenId;
}

/**
 * Validate a download token
 */
export async function validateDownloadToken(
    env: Env,
    tokenId: string
): Promise<DownloadToken | null> {
    const tokenData = await env.TATTLEHASH_KV.get(`download:token:${tokenId}`);

    if (!tokenData) {
        return null;
    }

    const token = JSON.parse(tokenData) as DownloadToken;

    // Check expiry
    if (Date.now() > token.expiresAt) {
        // Clean up expired token
        await env.TATTLEHASH_KV.delete(`download:token:${tokenId}`);
        return null;
    }

    return token;
}

/**
 * Generate a secure accept token for challenge acceptance
 */
export async function generateAcceptToken(
    env: Env,
    challengeId: string,
    counterpartyEmail: string
): Promise<string> {
    const tokenId = crypto.randomUUID();
    const tokenData = JSON.stringify({
        challengeId,
        counterpartyEmail,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Store in KV with 7 day TTL
    await env.TATTLEHASH_KV.put(
        `accept:token:${tokenId}`,
        tokenData,
        { expirationTtl: 604800 } // 7 days
    );

    return tokenId;
}

/**
 * Send Fire mode notification email to counterparty
 */
export async function sendFireNotification(
    env: Env,
    data: FireNotificationData
): Promise<EmailResult> {
    const { html, text } = generateFireNotificationEmail(data);

    const result = await sendEmail(env, {
        to: data.counterpartyEmail,
        subject: `${data.initiatorName} has sent you an attestation request`,
        html,
        text,
        tags: [
            { name: 'type', value: 'fire_notification' },
            { name: 'challenge_id', value: data.challengeId },
        ],
    });

    // Log the notification
    if (result.ok) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'fire_notification_sent',
            challenge_id: data.challengeId,
            to: data.counterpartyEmail,
            email_id: result.id,
        }));
    }

    return result;
}

// ============================================================================
// Auth Email Functions
// ============================================================================

/**
 * Send login verification code email
 */
export async function sendLoginCode(
    env: Env,
    email: string,
    code: string,
    expiresInMinutes: number = 10
): Promise<EmailResult> {
    const { html, text } = generateLoginCodeEmail({
        email,
        code,
        expiresInMinutes,
    });

    const result = await sendEmail(env, {
        to: email,
        subject: `${code} is your TattleHash login code`,
        html,
        text,
        tags: [
            { name: 'type', value: 'login_code' },
        ],
    });

    if (result.ok) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'login_code_email_sent',
            to: email,
            email_id: result.id,
        }));
    }

    return result;
}

/**
 * Send email verification email (for registration)
 */
export async function sendEmailVerification(
    env: Env,
    email: string,
    token: string,
    expiresInHours: number = 24
): Promise<EmailResult> {
    const { html, text } = generateEmailVerificationEmail({
        email,
        token,
        expiresInHours,
    });

    const result = await sendEmail(env, {
        to: email,
        subject: 'Verify your TattleHash email address',
        html,
        text,
        tags: [
            { name: 'type', value: 'email_verification' },
        ],
    });

    if (result.ok) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'email_verification_sent',
            to: email,
            email_id: result.id,
        }));
    }

    return result;
}

/**
 * Send password reset email
 */
export async function sendPasswordReset(
    env: Env,
    email: string,
    token: string,
    expiresInMinutes: number = 15
): Promise<EmailResult> {
    const { html, text } = generatePasswordResetEmail({
        email,
        token,
        expiresInMinutes,
    });

    const result = await sendEmail(env, {
        to: email,
        subject: 'Reset your TattleHash password',
        html,
        text,
        tags: [
            { name: 'type', value: 'password_reset' },
        ],
    });

    if (result.ok) {
        console.log(JSON.stringify({
            t: Date.now(),
            at: 'password_reset_email_sent',
            to: email,
            email_id: result.id,
        }));
    }

    return result;
}
