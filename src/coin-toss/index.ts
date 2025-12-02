/**
 * Coin Toss Module
 *
 * Provably fair coin toss for Gatekeeper fee-splitting.
 * Uses blockchain anchor block hash for randomness.
 */

// Types
export type {
    FeeArrangement,
    CoinSide,
    CoinTossStatus,
    CoinTossParty,
    CoinTossData,
    CoinTossVerification,
    CoinTossResultResponse,
    InitCoinTossInput,
} from './types';

export {
    FeeArrangementSchema,
    CoinSideSchema,
    CoinTossStatusSchema,
    InitCoinTossSchema,
    GATEKEEPER_FEE_CENTS,
    COIN_TOSS_KV_PREFIX,
    COIN_TOSS_TTL_SECONDS,
} from './types';

// Service functions
export {
    computeResult,
    determineSponsor,
    getOppositeSide,
    verifyCoinToss,
    initializeCoinToss,
    getCoinToss,
    markCounterpartyAccepted,
    recordCoinTossResult,
    cancelCoinToss,
    calculateFeeSplit,
    resolveIfReady,
} from './service';

// Handlers
export {
    getCoinTossVerification,
    getCoinTossStatus,
    buildShareText,
    buildShareData,
} from './handlers';
