
export interface AppError extends Error {
    code: string;
    status: number;
    details?: Record<string, any>;
}

export const ERRORS = {
    // Generic
    INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500, message: 'Internal server error' },
    VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400, message: 'Validation failed' },
    UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401, message: 'Unauthorized' },
    FORBIDDEN: { code: 'FORBIDDEN', status: 403, message: 'Forbidden' },
    NOT_FOUND: { code: 'NOT_FOUND', status: 404, message: 'Resource not found' },
    METHOD_NOT_ALLOWED: { code: 'METHOD_NOT_ALLOWED', status: 405, message: 'Method not allowed' },

    // Feature Flags
    FEATURE_DISABLED: { code: 'FEATURE_DISABLED', status: 503, message: 'Feature is currently disabled' },

    // Wallet
    WALLET_INVALID_ADDRESS: { code: 'WALLET_INVALID_ADDRESS', status: 400, message: 'Invalid wallet address' },
    WALLET_INVALID_SIGNATURE: { code: 'WALLET_INVALID_SIGNATURE', status: 400, message: 'Invalid signature' },
    WALLET_CHALLENGE_EXPIRED: { code: 'WALLET_CHALLENGE_EXPIRED', status: 400, message: 'Challenge expired' },
    WALLET_CHALLENGE_USED: { code: 'WALLET_CHALLENGE_USED', status: 400, message: 'Challenge already used' },
    WALLET_CHALLENGE_NOT_FOUND: { code: 'WALLET_CHALLENGE_NOT_FOUND', status: 404, message: 'Challenge not found' },

    // Funds
    FUNDS_INSUFFICIENT: { code: 'FUNDS_INSUFFICIENT', status: 400, message: 'Insufficient funds' },
    FUNDS_RPC_ERROR: { code: 'FUNDS_RPC_ERROR', status: 502, message: 'RPC provider error' },

    // Authentication
    AUTH_TOKEN_INVALID: { code: 'AUTH_TOKEN_INVALID', status: 401, message: 'Invalid authentication token' },
    AUTH_TOKEN_EXPIRED: { code: 'AUTH_TOKEN_EXPIRED', status: 401, message: 'Authentication token has expired' },
    AUTH_SECRET_NOT_CONFIGURED: { code: 'AUTH_SECRET_NOT_CONFIGURED', status: 500, message: 'Authentication not configured' },
    USER_NOT_FOUND: { code: 'USER_NOT_FOUND', status: 404, message: 'User not found' },

    // Challenges
    CHALLENGE_NOT_FOUND: { code: 'CHALLENGE_NOT_FOUND', status: 404, message: 'Challenge not found' },
    CHALLENGE_INVALID_TRANSITION: { code: 'CHALLENGE_INVALID_TRANSITION', status: 400, message: 'Invalid state transition' },
    CHALLENGE_LOCKED: { code: 'CHALLENGE_LOCKED', status: 400, message: 'Challenge is locked' },
    CHALLENGE_EXPIRED: { code: 'CHALLENGE_EXPIRED', status: 410, message: 'Challenge has expired' },
    CHALLENGE_ALREADY_ACCEPTED: { code: 'CHALLENGE_ALREADY_ACCEPTED', status: 409, message: 'Challenge already accepted' },
    CHALLENGE_INVALID_STATUS_FOR_ACCEPT: { code: 'CHALLENGE_INVALID_STATUS_FOR_ACCEPT', status: 400, message: 'Challenge status does not allow acceptance' },
    CHALLENGE_INVALID_STATUS_FOR_RESOLVE: { code: 'CHALLENGE_INVALID_STATUS_FOR_RESOLVE', status: 400, message: 'Challenge status does not allow resolution' },
    CHALLENGE_NOT_COUNTERPARTY: { code: 'CHALLENGE_NOT_COUNTERPARTY', status: 403, message: 'User is not the designated counterparty' },
    CHALLENGE_SOLO_NO_COUNTERPARTY: { code: 'CHALLENGE_SOLO_NO_COUNTERPARTY', status: 400, message: 'SOLO mode cannot have a counterparty' },
    CHALLENGE_COUNTERPARTY_REQUIRED: { code: 'CHALLENGE_COUNTERPARTY_REQUIRED', status: 400, message: 'Counterparty required for non-SOLO modes' },

    // Stakes (Enforced Mode)
    STAKE_NOT_FOUND: { code: 'STAKE_NOT_FOUND', status: 404, message: 'Stake not found' },
    STAKE_ALREADY_DEPOSITED: { code: 'STAKE_ALREADY_DEPOSITED', status: 409, message: 'Stake already deposited for this challenge' },
    STAKE_INVALID_STATUS: { code: 'STAKE_INVALID_STATUS', status: 400, message: 'Invalid stake status for this operation' },
    STAKE_CHAIN_NOT_ALLOWED: { code: 'STAKE_CHAIN_NOT_ALLOWED', status: 400, message: 'Chain not allowed for this challenge' },
    STAKE_ASSET_NOT_ALLOWED: { code: 'STAKE_ASSET_NOT_ALLOWED', status: 400, message: 'Asset not allowed for this challenge' },
    STAKE_AMOUNT_INSUFFICIENT: { code: 'STAKE_AMOUNT_INSUFFICIENT', status: 400, message: 'Stake amount does not meet minimum requirement' },
    TRAFFIC_LIGHT_RED: { code: 'TRAFFIC_LIGHT_RED', status: 400, message: 'Cannot proceed - traffic light is RED' },

    // ENF (Evidence-and-Forward)
    ENF_NOT_FOUND: { code: 'ENF_NOT_FOUND', status: 404, message: 'ENF bundle not found' },
    ENF_RECIPIENT_NOT_FOUND: { code: 'ENF_RECIPIENT_NOT_FOUND', status: 404, message: 'ENF recipient not found' },
    ENF_INVALID_TOKEN: { code: 'ENF_INVALID_TOKEN', status: 400, message: 'Invalid delivery token' },
    ENF_INVALID_TRANSITION: { code: 'ENF_INVALID_TRANSITION', status: 400, message: 'Invalid status transition' },
    ENF_ALREADY_SENT: { code: 'ENF_ALREADY_SENT', status: 409, message: 'ENF bundle has already been sent' },
    ENF_ALREADY_RESPONDED: { code: 'ENF_ALREADY_RESPONDED', status: 409, message: 'Already responded to this ENF' },
    ENF_EXPIRED: { code: 'ENF_EXPIRED', status: 410, message: 'ENF bundle has expired' },
    ENF_CANCELLED: { code: 'ENF_CANCELLED', status: 410, message: 'ENF bundle has been cancelled' },
    ENF_CANNOT_CANCEL: { code: 'ENF_CANNOT_CANCEL', status: 400, message: 'Cannot cancel ENF in current state' },
    ENF_NO_RECIPIENTS: { code: 'ENF_NO_RECIPIENTS', status: 400, message: 'ENF bundle has no recipients' },
    ENF_SIGNATURE_REQUIRED: { code: 'ENF_SIGNATURE_REQUIRED', status: 400, message: 'Signature is required for this acknowledgment type' },
    ENF_SIGNATURE_INVALID: { code: 'ENF_SIGNATURE_INVALID', status: 400, message: 'Invalid signature' },
};

export function createError(
    type: keyof typeof ERRORS,
    details?: Record<string, any>
): AppError {
    const errorDef = ERRORS[type];
    const error = new Error(errorDef.message) as AppError;
    error.code = errorDef.code;
    error.status = errorDef.status;
    error.details = details;
    return error;
}
