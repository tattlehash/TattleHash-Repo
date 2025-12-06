/**
 * Email Service - Resend Integration
 *
 * Handles all transactional emails for TattleHash.
 */

export {
    sendEmail,
    sendFireNotification,
    sendLoginCode,
    sendEmailVerification,
    sendPasswordReset,
    generateAcceptToken,
    generateDownloadToken,
    validateDownloadToken,
} from './service';
export {
    generateFireNotificationEmail,
    generateLoginCodeEmail,
    generateEmailVerificationEmail,
    generatePasswordResetEmail,
} from './templates';
export type { EmailOptions, FireNotificationData, DownloadToken } from './types';
