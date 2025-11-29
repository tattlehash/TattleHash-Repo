
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
