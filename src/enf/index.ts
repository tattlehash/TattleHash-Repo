/**
 * ENF (Evidence-and-Forward) Module
 *
 * Court-admissible evidence bundling with multi-party
 * acknowledgment tracking and full audit trail.
 */

// Types and schemas
export {
    ENF_DEFAULTS,
    RecipientInputSchema,
    CreateEnfBundleSchema,
    AcknowledgeEnfSchema,
    DeclineEnfSchema,
    SendEnfBundleSchema,
    CancelEnfBundleSchema,
    createEip191Message,
    canTransitionBundle,
    canTransitionRecipient,
    BUNDLE_TRANSITIONS,
    RECIPIENT_TRANSITIONS,
} from './types';

export type {
    RecipientInput,
    CreateEnfBundleInput,
    AcknowledgeEnfInput,
    DeclineEnfInput,
    SendEnfBundleInput,
    CancelEnfBundleInput,
    EnfBundleResponse,
    EnfRecipientResponse,
    EnfAcknowledgmentResponse,
} from './types';

// Core operations
export {
    createEnfBundle,
    getEnfBundle,
    listEnfBundles,
    getRecipientsByBundle,
    getRecipientByToken,
    getRecipientById,
    updateBundleStatus,
    updateRecipientStatus,
    sendEnfBundle,
    cancelEnfBundle,
    checkExpiredBundles,
} from './core';

export type { CreateBundleResult } from './core';

// Audit events
export {
    logEnfEvent,
    getEventsByBundle,
    getEventsByRecipient,
    exportBundleAuditTrail,
} from './events';

export type {
    LogEventInput,
    AuditExport,
    AuditEventRecord,
} from './events';

// Signature verification
export {
    createEnfSignature,
    getSignatureByRecipient,
    verifyEip191Signature,
    updateSignatureVerification,
    processSignedAcknowledgment,
} from './signatures';

export type {
    CreateSignatureInput,
    VerifySignatureInput,
    VerifySignatureResult,
    AcknowledgeWithSignatureInput,
    AcknowledgeWithSignatureResult,
} from './signatures';
