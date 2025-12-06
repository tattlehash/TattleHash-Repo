/**
 * Gatekeeper Mutual Verification Module
 *
 * Exports all functions and types for Gatekeeper mutual verification.
 */

// Types
export type {
    // Database rows
    CheckTypeRow,
    ProfileRow,
    ProfileCheckRow,
    UserVerificationRow,
    UserVerificationCheckRow,
    SessionRow,
    SessionCheckRow,
    EventRow,

    // Status types
    VerificationStatus,
    CheckStatus,
    SignalSummary,
    SignalType,
    SessionStatus,
    EventType,

    // API input types
    StartVerificationInput,
    SubmitWalletSignatureInput,
    CreateSessionInput,
    VerifyCounterpartyCodeInput,
    VerifyCounterpartyWalletInput,

    // API response types
    CheckType,
    Profile,
    CheckResult,
    UserVerification,
    SessionSummary,
    SessionDetail,
    CounterpartyViewSession,
} from './types';

// Profiles
export {
    getProfiles,
    getProfile,
    getProfileChecks,
    getAllCheckTypes,
    getCheckType,
} from './profiles';

// User Verification
export {
    getUserVerification,
    getActiveUserVerification,
    startVerification,
    submitWalletSignature,
    hasValidVerification,
} from './verification';

// Sessions
export {
    createSession,
    getSessionDetail,
    getSessionForCounterparty,
    verifyCounterpartyCode,
    submitCounterpartyWallet,
    proceedSession,
    abortSession,
    listUserSessions,
    resendVerificationCode,
} from './sessions';

// Checks
export {
    runCheck,
    runSessionCheck,
    calculateSignalSummary,
    calculateBadgeStatus,
} from './checks';

// Events
export { logEvent } from './events';
