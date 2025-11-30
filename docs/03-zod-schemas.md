# Zod Validation Schemas

> Runtime validation schemas for all API requests and responses.  
> Parse, don't validate — transform raw input into typed objects at the boundary.

---

## Installation

```bash
npm install zod
```

---

## Core Schemas

```typescript
// src/utils/validation.ts

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════════════

// Ethereum address (lowercase, 0x prefixed)
export const EthAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
  .transform((addr) => addr.toLowerCase());

// Chain ID (CAIP-2 format)
export const ChainIdSchema = z
  .string()
  .regex(/^eip155:\d+$|^solana-\w+$|^bitcoin-\w+$/, 'Invalid chain ID format');

// UUID
export const UuidSchema = z.string().uuid();

// Numeric string (for bigint-safe values)
export const NumericStringSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a numeric string');

// ISO timestamp
export const IsoTimestampSchema = z.string().datetime();

// Hex string
export const HexStringSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string');

// ═══════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════

export const ChallengeModeSchema = z.enum([
  'SOLO',
  'FIRE',
  'GATEKEEPER',
  'ENFORCED',
]);

export const ChallengeStatusSchema = z.enum([
  'DRAFT',
  'AWAITING_COUNTERPARTY',
  'AWAITING_GATEKEEPER',
  'INTENT_LOCKED',
  'ACTIVE',
  'AWAITING_RESOLUTION',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'DISPUTED',
]);

export const AssetTypeSchema = z.enum([
  'NATIVE',
  'ERC20',
  'BTC',
  'SPL',
]);

export const SnapshotPolicySchema = z.enum([
  'AT_INTENT_LOCK',
  'AT_FINALIZATION',
  'BOTH',
]);

export const StakeTypeSchema = z.enum([
  'BASE',
  'HONESTY_BOND',
]);

export const ResolutionStrategySchema = z.enum([
  'ORACLE',
  'MODERATOR',
]);

export const OutcomeSchema = z.enum([
  'CREATOR_WIN',
  'COUNTERPARTY_WIN',
  'DRAW',
  'NO_CONTEST',
]);
```

---

## Wallet Verification Schemas

```typescript
// src/gatekeeper/wallet/schemas.ts

import { z } from 'zod';
import { EthAddressSchema, ChainIdSchema, UuidSchema, HexStringSchema } from '../../utils/validation';

// ═══════════════════════════════════════════════════════════
// POST /gatekeeper/v2/wallet/challenge
// ═══════════════════════════════════════════════════════════

export const WalletChallengeRequestSchema = z.object({
  wallet_address: EthAddressSchema,
  chain_id: ChainIdSchema,
  user_id: UuidSchema.optional(),
});

export type WalletChallengeRequest = z.infer<typeof WalletChallengeRequestSchema>;

export const WalletChallengeResponseSchema = z.object({
  challenge_id: UuidSchema,
  message: z.string(),
  expires_at: z.string().datetime(),
});

export type WalletChallengeResponse = z.infer<typeof WalletChallengeResponseSchema>;

// ═══════════════════════════════════════════════════════════
// POST /gatekeeper/v2/wallet/verify
// ═══════════════════════════════════════════════════════════

export const WalletVerifyRequestSchema = z.object({
  challenge_id: UuidSchema,
  signature: HexStringSchema,
});

export type WalletVerifyRequest = z.infer<typeof WalletVerifyRequestSchema>;

export const WalletVerifyResponseSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'EXPIRED', 'FAILED']),
  wallet_address: EthAddressSchema,
  verified_at: z.string().datetime().nullable(),
  error: z.string().optional(),
});

export type WalletVerifyResponse = z.infer<typeof WalletVerifyResponseSchema>;
```

---

## Funds Check Schemas

```typescript
// src/gatekeeper/funds/schemas.ts

import { z } from 'zod';
import { 
  EthAddressSchema, 
  UuidSchema, 
  NumericStringSchema,
  AssetTypeSchema,
} from '../../utils/validation';

// Network codes
export const NetworkSchema = z.enum([
  'eth-mainnet',
  'polygon-mainnet',
  'bsc-mainnet',
  'arbitrum-one',
  'optimism-mainnet',
  'base-mainnet',
  'solana-mainnet',
  'bitcoin-mainnet',
]);

// ═══════════════════════════════════════════════════════════
// POST /gatekeeper/v2/funds/check
// ═══════════════════════════════════════════════════════════

export const FundsCheckRequestSchema = z.object({
  wallet_address: EthAddressSchema,
  network: NetworkSchema,
  asset_type: AssetTypeSchema,
  token_address: EthAddressSchema.optional(), // Required for ERC20
  min_balance: NumericStringSchema,
  challenge_id: UuidSchema.optional(),
  user_id: UuidSchema.optional(),
}).refine(
  (data) => {
    // token_address required for ERC20
    if (data.asset_type === 'ERC20' && !data.token_address) {
      return false;
    }
    return true;
  },
  { message: 'token_address is required for ERC20 assets' }
);

export type FundsCheckRequest = z.infer<typeof FundsCheckRequestSchema>;

export const FundsCheckResponseSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'ERROR']),
  proof_type: z.enum(['OPAQUE_V1', 'SNARK', 'STARK', 'SEMAPHORE']),
  provider: z.string(),
  checked_at: z.string().datetime(),
});

export type FundsCheckResponse = z.infer<typeof FundsCheckResponseSchema>;
```

---

## Challenge Schemas

```typescript
// src/challenges/schemas.ts

import { z } from 'zod';
import {
  UuidSchema,
  EthAddressSchema,
  NumericStringSchema,
  IsoTimestampSchema,
  ChallengeModeSchema,
  AssetTypeSchema,
  ResolutionStrategySchema,
  OutcomeSchema,
} from '../utils/validation';
import { NetworkSchema } from '../gatekeeper/funds/schemas';

// ═══════════════════════════════════════════════════════════
// GATEKEEPER REQUIREMENT (nested)
// ═══════════════════════════════════════════════════════════

const FundsCheckConfigSchema = z.object({
  asset_type: AssetTypeSchema,
  token_address: EthAddressSchema.optional(),
  min_balance: NumericStringSchema,
  currency_symbol: z.string().max(16),
});

const GatekeeperRequirementSchema = z.object({
  wallet_address: EthAddressSchema,
  network: NetworkSchema,
  funds_checks: z.array(FundsCheckConfigSchema).optional(),
});

// ═══════════════════════════════════════════════════════════
// FIRE MODE CONFIG
// ═══════════════════════════════════════════════════════════

const FireConfigSchema = z.object({
  honesty_bond_amount: NumericStringSchema,
  currency_code: z.string().max(16),
  resolution_strategy: ResolutionStrategySchema,
  oracle_source: z.string().max(256).optional(),
});

// ═══════════════════════════════════════════════════════════
// ENFORCED MODE CONFIG (user-configurable timeouts)
// ═══════════════════════════════════════════════════════════

const EnforcedConfigSchema = z.object({
  accept_timeout_seconds: z
    .number()
    .int()
    .min(60)           // 1 minute
    .max(604800)       // 7 days
    .default(900),     // 15 minutes
  response_timeout_seconds: z
    .number()
    .int()
    .min(300)          // 5 minutes
    .max(2592000)      // 30 days
    .default(86400),   // 24 hours
  dispute_timeout_seconds: z
    .number()
    .int()
    .min(3600)         // 1 hour
    .max(2592000)      // 30 days
    .default(259200),  // 72 hours
});

// ═══════════════════════════════════════════════════════════
// POST /challenges
// ═══════════════════════════════════════════════════════════

export const CreateChallengeRequestSchema = z.object({
  mode: ChallengeModeSchema,
  title: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  counterparty_user_id: UuidSchema.optional(),
  expires_at: IsoTimestampSchema.optional(),
  
  // Mode-specific configs
  fire_config: FireConfigSchema.optional(),
  enforced_config: EnforcedConfigSchema.optional(),
  
  // Gatekeeper requirements
  gatekeeper_requirements: z.object({
    creator: GatekeeperRequirementSchema.optional(),
    counterparty: GatekeeperRequirementSchema.optional(),
  }).optional(),
}).refine(
  (data) => {
    // SOLO mode doesn't need counterparty
    if (data.mode === 'SOLO' && data.counterparty_user_id) {
      return false;
    }
    // Non-SOLO modes need counterparty (or will be set later)
    return true;
  },
  { message: 'SOLO mode cannot have a counterparty' }
).refine(
  (data) => {
    // FIRE mode requires fire_config
    if (data.mode === 'FIRE' && !data.fire_config) {
      return false;
    }
    return true;
  },
  { message: 'FIRE mode requires fire_config' }
);

export type CreateChallengeRequest = z.infer<typeof CreateChallengeRequestSchema>;

// ═══════════════════════════════════════════════════════════
// POST /challenges/:id/accept
// ═══════════════════════════════════════════════════════════

export const AcceptChallengeRequestSchema = z.object({
  wallet_address: EthAddressSchema.optional(),
});

export type AcceptChallengeRequest = z.infer<typeof AcceptChallengeRequestSchema>;

// ═══════════════════════════════════════════════════════════
// POST /challenges/:id/resolve
// ═══════════════════════════════════════════════════════════

export const ResolveChallengeRequestSchema = z.object({
  outcome: OutcomeSchema,
  resolution_data: z.record(z.unknown()).optional(),
});

export type ResolveChallengeRequest = z.infer<typeof ResolveChallengeRequestSchema>;

// ═══════════════════════════════════════════════════════════
// RESPONSE SCHEMA
// ═══════════════════════════════════════════════════════════

export const ChallengeResponseSchema = z.object({
  id: UuidSchema,
  mode: ChallengeModeSchema,
  status: z.string(), // ChallengeStatus
  title: z.string(),
  description: z.string().nullable(),
  creator_user_id: UuidSchema,
  counterparty_user_id: UuidSchema.nullable(),
  expires_at: IsoTimestampSchema.nullable(),
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
  initiator_hash: z.string().optional(),
  counter_hash: z.string().optional(),
  final_hash: z.string().optional(),
});

export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;
```

---

## Webhook Schemas

```typescript
// src/relay/schemas.ts

import { z } from 'zod';
import { UuidSchema, IsoTimestampSchema, ChallengeModeSchema } from '../utils/validation';

// ═══════════════════════════════════════════════════════════
// WEBHOOK ENDPOINT REGISTRATION
// ═══════════════════════════════════════════════════════════

export const RegisterWebhookRequestSchema = z.object({
  url: z.string().url(),
  description: z.string().max(256).optional(),
  events: z.array(z.string()).optional(), // Filter to specific events
});

export type RegisterWebhookRequest = z.infer<typeof RegisterWebhookRequestSchema>;

// ═══════════════════════════════════════════════════════════
// WEBHOOK PAYLOAD (what we send)
// ═══════════════════════════════════════════════════════════

export const WebhookPayloadSchema = z.object({
  id: UuidSchema,
  type: z.string(),
  created_at: IsoTimestampSchema,
  mode: ChallengeModeSchema,
  challenge: z.object({
    id: UuidSchema,
    status: z.string(),
    title: z.string(),
    expires_at: IsoTimestampSchema.nullable(),
  }),
  participants: z.array(z.object({
    role: z.enum(['creator', 'counterparty']),
    user_id: UuidSchema,
    wallet_address: z.string().optional(),
  })),
  metadata: z.record(z.unknown()).optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
```

---

## Validation Helper

```typescript
// src/utils/validate.ts

import { z, ZodError } from 'zod';
import { err } from '../lib/http';

/**
 * Parse request body with Zod schema.
 * Returns typed data or throws HTTP error response.
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<T> {
  let body: unknown;
  
  try {
    body = await request.json();
  } catch {
    throw err(400, 'invalid_json', { message: 'Request body must be valid JSON' });
  }
  
  try {
    return schema.parse(body);
  } catch (e) {
    if (e instanceof ZodError) {
      throw err(400, 'validation_error', {
        message: 'Request validation failed',
        errors: e.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      });
    }
    throw e;
  }
}

/**
 * Validate query parameters.
 */
export function parseQuery<T>(
  url: URL,
  schema: z.ZodType<T>
): T {
  const params = Object.fromEntries(url.searchParams);
  return schema.parse(params);
}

// Usage example:
// const data = await parseBody(request, WalletChallengeRequestSchema);
// Now `data` is fully typed as WalletChallengeRequest
```

---

## Schema Export Index

```typescript
// src/utils/validation.ts (append to bottom)

// Re-export all schemas for easy importing
export * from '../gatekeeper/wallet/schemas';
export * from '../gatekeeper/funds/schemas';
export * from '../challenges/schemas';
export * from '../relay/schemas';
```
