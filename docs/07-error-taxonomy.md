# Error Taxonomy

> All error codes, HTTP statuses, and messages.  
> Single source of truth for error handling.

---

## Error Format

All errors return this structure:

```json
{
  "error": {
    "code": "E1005",
    "message": "Signature verification failed",
    "details": { ... }
  }
}
```

---

## Error Code Ranges

| Range | Category |
|-------|----------|
| `E1xxx` | Wallet verification errors |
| `E2xxx` | Funds verification errors |
| `E3xxx` | Challenge lifecycle errors |
| `E4xxx` | Mode-specific errors |
| `E5xxx` | Payment/stake errors |
| `E6xxx` | Webhook/notification errors |
| `E9xxx` | System errors |

---

## Implementation

```typescript
// src/errors.ts

export interface TattleHashError {
  code: string;
  status: number;
  message: string;
}

export const ERRORS = {
  // ═══════════════════════════════════════════════════════════
  // E1xxx: WALLET VERIFICATION
  // ═══════════════════════════════════════════════════════════
  
  WALLET_INVALID_ADDRESS: {
    code: 'E1001',
    status: 400,
    message: 'Invalid wallet address format',
  },
  WALLET_INVALID_CHAIN: {
    code: 'E1002',
    status: 400,
    message: 'Invalid or unsupported chain ID',
  },
  WALLET_CHALLENGE_NOT_FOUND: {
    code: 'E1003',
    status: 404,
    message: 'Wallet verification challenge not found',
  },
  WALLET_CHALLENGE_EXPIRED: {
    code: 'E1004',
    status: 410,
    message: 'Wallet verification challenge has expired',
  },
  WALLET_SIGNATURE_INVALID: {
    code: 'E1005',
    status: 400,
    message: 'Signature verification failed',
  },
  WALLET_ADDRESS_MISMATCH: {
    code: 'E1006',
    status: 400,
    message: 'Recovered address does not match challenge address',
  },
  WALLET_CHALLENGE_ALREADY_USED: {
    code: 'E1007',
    status: 409,
    message: 'Challenge has already been verified or failed',
  },
  WALLET_INVALID_SIGNATURE_FORMAT: {
    code: 'E1008',
    status: 400,
    message: 'Invalid signature format (must be hex string)',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E2xxx: FUNDS VERIFICATION
  // ═══════════════════════════════════════════════════════════
  
  FUNDS_INVALID_ADDRESS: {
    code: 'E2001',
    status: 400,
    message: 'Invalid wallet address for funds check',
  },
  FUNDS_UNSUPPORTED_NETWORK: {
    code: 'E2002',
    status: 400,
    message: 'Network not supported for funds verification',
  },
  FUNDS_TOKEN_ADDRESS_REQUIRED: {
    code: 'E2003',
    status: 400,
    message: 'Token address required for ERC20 asset type',
  },
  FUNDS_RPC_ERROR: {
    code: 'E2004',
    status: 502,
    message: 'Failed to fetch balance from RPC provider',
  },
  FUNDS_INVALID_THRESHOLD: {
    code: 'E2005',
    status: 400,
    message: 'Invalid minimum balance threshold',
  },
  FUNDS_INSUFFICIENT: {
    code: 'E2006',
    status: 200, // Not an HTTP error, just a failed check
    message: 'Balance below required threshold',
  },
  FUNDS_INVALID_TOKEN: {
    code: 'E2007',
    status: 400,
    message: 'Invalid or unrecognized token address',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E3xxx: CHALLENGE LIFECYCLE
  // ═══════════════════════════════════════════════════════════
  
  CHALLENGE_INVALID_MODE: {
    code: 'E3001',
    status: 400,
    message: 'Invalid challenge mode',
  },
  CHALLENGE_SOLO_NO_COUNTERPARTY: {
    code: 'E3002',
    status: 400,
    message: 'SOLO mode cannot have a counterparty',
  },
  CHALLENGE_FIRE_CONFIG_REQUIRED: {
    code: 'E3003',
    status: 400,
    message: 'FIRE mode requires fire_config',
  },
  CHALLENGE_INVALID_TIMEOUT: {
    code: 'E3004',
    status: 400,
    message: 'Invalid timeout value (outside allowed range)',
  },
  CHALLENGE_NOT_FOUND: {
    code: 'E3010',
    status: 404,
    message: 'Challenge not found',
  },
  CHALLENGE_INVALID_STATUS_FOR_ACCEPT: {
    code: 'E3011',
    status: 409,
    message: 'Challenge is not in a status that allows acceptance',
  },
  CHALLENGE_NOT_COUNTERPARTY: {
    code: 'E3012',
    status: 403,
    message: 'You are not the designated counterparty for this challenge',
  },
  CHALLENGE_EXPIRED: {
    code: 'E3013',
    status: 410,
    message: 'Challenge has expired',
  },
  CHALLENGE_INVALID_TRANSITION: {
    code: 'E3014',
    status: 409,
    message: 'Invalid status transition for this challenge',
  },
  CHALLENGE_ALREADY_ACCEPTED: {
    code: 'E3015',
    status: 409,
    message: 'Challenge has already been accepted',
  },
  CHALLENGE_INVALID_STATUS_FOR_RESOLVE: {
    code: 'E3020',
    status: 409,
    message: 'Challenge is not in a status that allows resolution',
  },
  CHALLENGE_INVALID_OUTCOME: {
    code: 'E3021',
    status: 400,
    message: 'Invalid resolution outcome',
  },
  CHALLENGE_MISSING_REQUIREMENTS: {
    code: 'E3022',
    status: 400,
    message: 'Missing required gatekeeper requirements',
  },
  CHALLENGE_COUNTERPARTY_REQUIRED: {
    code: 'E3023',
    status: 400,
    message: 'This mode requires a counterparty',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E4xxx: MODE-SPECIFIC ERRORS
  // ═══════════════════════════════════════════════════════════
  
  FIRE_ORACLE_UNAVAILABLE: {
    code: 'E4001',
    status: 503,
    message: 'Oracle data source is unavailable',
  },
  FIRE_ORACLE_AMBIGUOUS: {
    code: 'E4002',
    status: 422,
    message: 'Oracle returned ambiguous result',
  },
  FIRE_BOND_AMOUNT_INVALID: {
    code: 'E4003',
    status: 400,
    message: 'Invalid honesty bond amount',
  },
  ENFORCED_TIMEOUT_OUT_OF_RANGE: {
    code: 'E4010',
    status: 400,
    message: 'Timeout value outside allowed range',
  },
  GATEKEEPER_VERIFICATION_PENDING: {
    code: 'E4020',
    status: 409,
    message: 'Gatekeeper verification still in progress',
  },
  GATEKEEPER_VERIFICATION_FAILED: {
    code: 'E4021',
    status: 422,
    message: 'Gatekeeper verification failed for one or more parties',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E5xxx: PAYMENT/STAKE ERRORS
  // ═══════════════════════════════════════════════════════════
  
  PAYMENT_AUTHORIZATION_FAILED: {
    code: 'E5001',
    status: 402,
    message: 'Payment authorization failed',
  },
  PAYMENT_CAPTURE_FAILED: {
    code: 'E5002',
    status: 402,
    message: 'Payment capture failed',
  },
  PAYMENT_REFUND_FAILED: {
    code: 'E5003',
    status: 500,
    message: 'Payment refund failed',
  },
  STAKE_NOT_FOUND: {
    code: 'E5010',
    status: 404,
    message: 'Stake record not found',
  },
  STAKE_ALREADY_PROCESSED: {
    code: 'E5011',
    status: 409,
    message: 'Stake has already been processed',
  },
  STAKE_INSUFFICIENT_FUNDS: {
    code: 'E5012',
    status: 402,
    message: 'Insufficient funds for stake',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E6xxx: WEBHOOK/NOTIFICATION ERRORS
  // ═══════════════════════════════════════════════════════════
  
  WEBHOOK_INVALID_URL: {
    code: 'E6001',
    status: 400,
    message: 'Invalid webhook URL',
  },
  WEBHOOK_NOT_FOUND: {
    code: 'E6002',
    status: 404,
    message: 'Webhook endpoint not found',
  },
  WEBHOOK_DELIVERY_FAILED: {
    code: 'E6003',
    status: 502,
    message: 'Webhook delivery failed after retries',
  },
  NOTIFICATION_TEMPLATE_NOT_FOUND: {
    code: 'E6010',
    status: 500,
    message: 'Notification template not found',
  },
  NOTIFICATION_SEND_FAILED: {
    code: 'E6011',
    status: 502,
    message: 'Failed to send notification',
  },
  
  // ═══════════════════════════════════════════════════════════
  // E9xxx: SYSTEM ERRORS
  // ═══════════════════════════════════════════════════════════
  
  INTERNAL_ERROR: {
    code: 'E9001',
    status: 500,
    message: 'Internal server error',
  },
  DATABASE_ERROR: {
    code: 'E9002',
    status: 500,
    message: 'Database operation failed',
  },
  RATE_LIMITED: {
    code: 'E9003',
    status: 429,
    message: 'Rate limit exceeded',
  },
  VALIDATION_ERROR: {
    code: 'E9004',
    status: 400,
    message: 'Request validation failed',
  },
  AUTH_REQUIRED: {
    code: 'E9005',
    status: 401,
    message: 'Authentication required',
  },
  AUTH_INVALID: {
    code: 'E9006',
    status: 401,
    message: 'Invalid authentication credentials',
  },
  FORBIDDEN: {
    code: 'E9007',
    status: 403,
    message: 'Access forbidden',
  },
  NOT_FOUND: {
    code: 'E9008',
    status: 404,
    message: 'Resource not found',
  },
  IDEMPOTENCY_CONFLICT: {
    code: 'E9009',
    status: 409,
    message: 'Idempotency key conflict',
  },
  FEATURE_DISABLED: {
    code: 'E9010',
    status: 503,
    message: 'Feature is currently disabled',
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

/**
 * Create an error response
 */
export function createError(
  errorKey: ErrorCode,
  details?: Record<string, unknown>
): Response {
  const error = ERRORS[errorKey];
  return new Response(
    JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        ...(details && { details }),
      },
    }),
    {
      status: error.status,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    }
  );
}

/**
 * Check if a value is a TattleHash error response
 */
export function isErrorResponse(response: Response): boolean {
  return response.status >= 400;
}
```

---

## Usage in Handlers

```typescript
// Example: src/handlers/gatekeeper.ts

import { createError, ERRORS } from '../errors';
import { parseBody } from '../utils/validate';
import { WalletChallengeRequestSchema } from '../gatekeeper/wallet/schemas';

export async function postWalletChallenge(
  request: Request,
  env: Env
): Promise<Response> {
  // Validation errors handled by parseBody
  let data;
  try {
    data = await parseBody(request, WalletChallengeRequestSchema);
  } catch (e) {
    return createError('VALIDATION_ERROR', { details: e });
  }
  
  // Business logic errors
  if (!isValidEthAddress(data.wallet_address)) {
    return createError('WALLET_INVALID_ADDRESS', {
      provided: data.wallet_address,
    });
  }
  
  if (!isSupportedChain(data.chain_id)) {
    return createError('WALLET_INVALID_CHAIN', {
      provided: data.chain_id,
      supported: SUPPORTED_CHAINS,
    });
  }
  
  // ... rest of handler
}
```

---

## Error Logging

```typescript
// src/lib/logger.ts

import type { TattleHashError } from '../errors';

export function logError(
  error: TattleHashError,
  context: Record<string, unknown>
): void {
  console.error(JSON.stringify({
    t: Date.now(),
    level: 'error',
    code: error.code,
    message: error.message,
    ...context,
  }));
}

// Usage:
// logError(ERRORS.WALLET_SIGNATURE_INVALID, { 
//   challenge_id: '...', 
//   recovered: '0x...', 
//   expected: '0x...' 
// });
```
