/**
 * Email Types
 */

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    tags?: Array<{ name: string; value: string }>;
}

export interface EmailResult {
    ok: boolean;
    id?: string;
    error?: string;
}

export interface FireNotificationData {
    /** Counterparty email address */
    counterpartyEmail: string;
    /** Challenge ID */
    challengeId: string;
    /** Challenge title */
    title: string;
    /** Challenge description */
    description?: string;
    /** Custom note from initiator */
    customNote?: string;
    /** Initiator's display name or email */
    initiatorName: string;
    /** Secure token for accepting the challenge */
    acceptToken: string;
    /** When the challenge expires */
    expiresAt?: string;
    /** Whether to include a 24hr download link for the evidence */
    includeDownloadLink?: boolean;
    /** Temporary download URL (24hr expiry) */
    downloadUrl?: string;
}

export interface DownloadToken {
    challengeId: string;
    createdAt: number;
    expiresAt: number;
}
