/**
 * Stakes Module
 *
 * Full escrow system for ENFORCED mode transactions.
 */

// Types
export type {
    StakeStatus,
    StakeEventType,
    TrafficLightState,
    TrafficLightEvaluation,
    StakeVerification,
    Stake,
    EnforcedThreshold,
    TrafficLightRecord,
    StakeEvent,
    CreateEnforcedChallengeInput,
    DepositStakeInput,
    ReleaseStakeInput,
    StakeResult,
    EnforcedChallengeStatus,
} from './types';

export {
    CreateEnforcedChallengeSchema,
    DepositStakeSchema,
    ReleaseStakeSchema,
    ENFORCED_DEFAULTS,
    TIMEOUT_CONSTRAINTS,
} from './types';

// Core stake operations
export {
    createStake,
    getStakeById,
    getStakesByChallenge,
    getStakeByUserAndChallenge,
    confirmStakeDeposit,
    lockStake,
    releaseStake,
    slashStake,
    createThreshold,
    getThresholdByChallenge,
    recordStakeEvent,
    getStakeEvents,
    isChainAllowed,
    isAssetAllowed,
    validateStakeAmount,
} from './core';

// Traffic light evaluation
export {
    evaluateTrafficLight,
    getTrafficLightHistory,
    getCurrentTrafficLight,
    isGreen,
    isRed,
    canProceed,
} from './traffic-light';
