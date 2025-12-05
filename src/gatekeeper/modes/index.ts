
export { handleSoloMode, completeSoloChallenge } from './solo';
export {
    handleEnforcedMode,
    checkEnforcedTimeouts,
    enforceCompletion,
    // Full Enforced Mode with Stakes
    createEnforcedChallenge,
    depositEnforcedStake,
    acceptEnforcedChallenge,
    completeEnforcedChallenge,
    raiseEnforcedDispute,
    resolveEnforcedDispute,
    handleEnforcedTimeout,
    getEnforcedChallengeStatus,
} from './enforced';
export { handleFireMode, depositBond, raiseDispute, resolveDispute } from './fire';
// Auto-Downgrade (Patent: TraceAI v3.1)
export {
    handleCounterpartyTimeout,
    processDowngrades,
    findExpiredPendingChallenges,
    manualDowngrade,
    // Timeout Configuration
    COUNTERPARTY_TIMEOUT_MS,
    DEFAULT_COUNTERPARTY_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    getConfiguredTimeout,
    // Expiry Checking
    isChallengeExpired,
    // Alarm Clock Mode - Set/Modify Expiry
    setChallengeExpiry,
    clearChallengeExpiry,
    extendChallengeExpiry,
} from './downgrade';
export type { EnforcedConfig } from './enforced';
export type { FireConfig, BondDeposit } from './fire';
export type { DowngradeResult, DowngradeSweepResult, SetExpiryInput, ExpiryResult } from './downgrade';
