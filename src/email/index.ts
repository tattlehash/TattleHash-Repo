/**
 * Email Service - Resend Integration
 *
 * Handles all transactional emails for TattleHash.
 */

export {
    sendEmail,
    sendFireNotification,
    generateAcceptToken,
    generateDownloadToken,
    validateDownloadToken,
} from './service';
export { generateFireNotificationEmail } from './templates';
export type { EmailOptions, FireNotificationData, DownloadToken } from './types';
