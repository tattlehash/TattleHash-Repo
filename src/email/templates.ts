/**
 * Email Templates
 *
 * HTML and plain text email templates for TattleHash notifications.
 */

import type { FireNotificationData } from './types';

const BRAND_COLOR = '#00d4ff';
const BRAND_COLOR_DARK = '#0099cc';
const BASE_URL = 'https://tattlehash.com';

/**
 * Generate Fire mode notification email
 */
export function generateFireNotificationEmail(data: FireNotificationData): { html: string; text: string } {
    const acceptUrl = `${BASE_URL}/accept.html?token=${data.acceptToken}&id=${data.challengeId}`;
    const viewUrl = `${BASE_URL}/view.html?id=${data.challengeId}&token=${data.acceptToken}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Attestation Request</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f; color: #e0e0e0;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #12121a; border-radius: 16px; overflow: hidden; border: 1px solid #2a2a3a;">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 40px; background: linear-gradient(135deg, ${BRAND_COLOR}22 0%, transparent 100%); border-bottom: 1px solid #2a2a3a;">
                            <table role="presentation" style="width: 100%;">
                                <tr>
                                    <td>
                                        <span style="font-size: 24px; font-weight: 700; color: #ffffff;">
                                            <span style="color: ${BRAND_COLOR};">&#128737;</span> TattleHash
                                        </span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <!-- Alert Badge -->
                            <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                                <tr>
                                    <td style="text-align: center;">
                                        <span style="display: inline-block; background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%); color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                                            &#128293; Fire Mode Request
                                        </span>
                                    </td>
                                </tr>
                            </table>

                            <!-- Greeting -->
                            <p style="font-size: 18px; color: #ffffff; margin: 0 0 16px 0;">
                                <strong>${escapeHtml(data.initiatorName)}</strong> has sent you an attestation request.
                            </p>

                            <!-- Challenge Details Box -->
                            <table role="presentation" style="width: 100%; background-color: #1a1a24; border-radius: 12px; margin: 24px 0; border: 1px solid #2a2a3a;">
                                <tr>
                                    <td style="padding: 24px;">
                                        <p style="margin: 0 0 8px 0; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px;">
                                            Attestation Title
                                        </p>
                                        <p style="margin: 0 0 20px 0; font-size: 18px; color: #ffffff; font-weight: 600;">
                                            ${escapeHtml(data.title)}
                                        </p>

                                        ${data.description ? `
                                        <p style="margin: 0 0 8px 0; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px;">
                                            Description
                                        </p>
                                        <p style="margin: 0; font-size: 14px; color: #ccc; line-height: 1.6;">
                                            ${escapeHtml(data.description)}
                                        </p>
                                        ` : ''}
                                    </td>
                                </tr>
                            </table>

                            ${data.customNote ? `
                            <!-- Custom Note from Initiator -->
                            <table role="presentation" style="width: 100%; background-color: #1e2a35; border-radius: 12px; margin: 24px 0; border-left: 4px solid ${BRAND_COLOR};">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0 0 8px 0; font-size: 12px; color: ${BRAND_COLOR}; font-weight: 600;">
                                            &#128172; Personal Note from ${escapeHtml(data.initiatorName)}
                                        </p>
                                        <p style="margin: 0; font-size: 14px; color: #e0e0e0; line-height: 1.6; font-style: italic;">
                                            "${escapeHtml(data.customNote)}"
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}

                            ${data.includeDownloadLink && data.downloadUrl ? `
                            <!-- Download Link -->
                            <table role="presentation" style="width: 100%; background-color: #1a2a1a; border-radius: 12px; margin: 24px 0; border: 1px solid #2a4a2a;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0 0 12px 0; font-size: 14px; color: #4caf50;">
                                            &#128230; Evidence document available for download
                                        </p>
                                        <a href="${escapeHtml(data.downloadUrl)}" style="display: inline-block; background-color: #2a4a2a; color: #4caf50; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;">
                                            Download Evidence (expires in 24 hours)
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}

                            <!-- CTA Buttons -->
                            <table role="presentation" style="width: 100%; margin: 32px 0;">
                                <tr>
                                    <td style="text-align: center;">
                                        <a href="${acceptUrl}" style="display: inline-block; background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_COLOR_DARK} 100%); color: #0a0a0f; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                                            View & Respond
                                        </a>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center; padding-top: 16px;">
                                        <a href="${viewUrl}" style="color: ${BRAND_COLOR}; text-decoration: none; font-size: 14px;">
                                            View details without responding &#8594;
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            ${data.expiresAt ? `
                            <!-- Expiry Warning -->
                            <p style="margin: 24px 0 0 0; font-size: 13px; color: #ff9800; text-align: center;">
                                &#9203; This request expires on ${formatDate(data.expiresAt)}
                            </p>
                            ` : ''}
                        </td>
                    </tr>

                    <!-- What is TattleHash -->
                    <tr>
                        <td style="padding: 24px 40px; background-color: #0d0d12; border-top: 1px solid #2a2a3a;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px;">
                                What is TattleHash?
                            </p>
                            <p style="margin: 0; font-size: 13px; color: #aaa; line-height: 1.6;">
                                TattleHash creates blockchain-anchored proof of agreements. When you respond to this request,
                                both parties receive cryptographic evidence of the attestation, permanently recorded on Polygon.
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #2a2a3a;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">
                                &#128737; TattleHash - Immutable Proof, Zero Trust Required
                            </p>
                            <p style="margin: 0; font-size: 11px; color: #555;">
                                This email was sent because ${escapeHtml(data.initiatorName)} listed your email address as a counterparty.
                                <br>
                                <a href="${BASE_URL}/unsubscribe" style="color: #666; text-decoration: underline;">Unsubscribe</a> |
                                <a href="${BASE_URL}/privacy.html" style="color: #666; text-decoration: underline;">Privacy Policy</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();

    // Plain text version
    const text = `
${data.initiatorName} has sent you an attestation request on TattleHash.

ATTESTATION DETAILS
-------------------
Title: ${data.title}
${data.description ? `Description: ${data.description}\n` : ''}
${data.customNote ? `\nPersonal Note from ${data.initiatorName}:\n"${data.customNote}"\n` : ''}
${data.includeDownloadLink && data.downloadUrl ? `\nDownload Evidence (24hr link): ${data.downloadUrl}\n` : ''}
${data.expiresAt ? `\nExpires: ${formatDate(data.expiresAt)}\n` : ''}

VIEW & RESPOND
--------------
${acceptUrl}

WHAT IS TATTLEHASH?
-------------------
TattleHash creates blockchain-anchored proof of agreements. When you respond,
both parties receive cryptographic evidence permanently recorded on Polygon.

---
This email was sent because ${data.initiatorName} listed your email as a counterparty.
Unsubscribe: ${BASE_URL}/unsubscribe
    `.trim();

    return { html, text };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
    const htmlEntities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    } catch {
        return dateStr;
    }
}
