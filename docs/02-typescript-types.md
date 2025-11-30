# TypeScript Types

> All TypeScript interfaces, types, and enums for TattleHash.  
> These are the source of truth for data shapes.

---

## Core Enums

```typescript
// src/types.ts (extend existing)

// ═══════════════════════════════════════════════════════════
// CHALLENGE MODES
// ═══════════════════════════════════════════════════════════

export type ChallengeMode = 'SOLO' | 'FIRE' | 'GATEKEEPER' | 'ENFORCED';

// ═══════════════════════════════════════════════════════════
// CHALLENGE STATUS (shared lifecycle)
// ═══════════════════════════════════════════════════════════

export type ChallengeStatus =
  | 'DRAFT'                    // Creator configuring
  | 'AWAITING_COUNTERPARTY'    // Waiting for acceptance
  | 'AWAITING_GATEKEEPER'      // Verification in progress
  | 'INTENT_LOCKED'            // Both parties committed
  | 'ACTIVE'                   // Ongoing (for time-based modes)
  | 'AWAITING_RESOLUTION'      // Waiting for outcome
  | 'COMPLETED'                // Successfully resolved
  | 'CANCELLED'                // Cancelled by party
  | 'EXPIRED'                  // Timed out
  | 'DISPUTED';                // Under dispute

// ═══════════════════════════════════════════════════════════
// WALLET VERIFICATION
// ═══════════════════════════════════════════════════════════

export type WalletVerificationMethod = 'EIP191' | 'EIP712' | 'DUST_TX';

export type WalletVerificationStatus = 
  | 'PENDING' 
  | 'VERIFIED' 
  | 'EXPIRED' 
  | 'FAILED';

// ═══════════════════════════════════════════════════════════
// FUNDS VERIFICATION
// ═══════════════════════════════════════════════════════════

export type AssetType = 'NATIVE' | 'ERC20' | 'BTC' | 'SPL';

export type FundsCheckStatus = 
  | 'PENDING' 
  | 'PASSED' 
  | 'FAILED' 
  | 'ERROR';

export type SnapshotPolicy = 
  | 'AT_INTENT_LOCK' 
  | 'AT_FINALIZATION' 
  | 'BOTH';

export type ZkProofType = 
  | 'OPAQUE_V1'     // Privacy-preserving pass/fail (v1)
  | 'SNARK'         // Future: zk-SNARK
  | 'STARK'         // Future: zk-STARK
  | 'SEMAPHORE';    // Future: Semaphore protocol

// ═══════════════════════════════════════════════════════════
// STAKES
// ═══════════════════════════════════════════════════════════

export type StakeType = 'BASE' | 'HONESTY_BOND';

export type StakeStatus = 
  | 'HELD' 
  | 'RELEASED' 
  | 'SLASHED' 
  | 'REFUNDED';

// ═══════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════

export type WebhookEventType =
  | 'challenge.created'
  | 'challenge.intent_locked'
  | 'challenge.gatekeeper_verification_required'
  | 'challenge.gatekeeper_passed'
  | 'challenge.gatekeeper_failed'
  | 'challenge.timeout_warning'
  | 'challenge.timeout_expired'
  | 'challenge.completed'
  | 'challenge.disputed'
  | 'stake.slashed'
  | 'stake.refunded';

export type WebhookStatus = 
  | 'PENDING' 
  | 'DELIVERED' 
  | 'FAILED';

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

export type NotificationType = 'EMAIL' | 'SMS';

export type NotificationStatus = 
  | 'QUEUED' 
  | 'SENT' 
  | 'FAILED';

export type NotificationTemplateKey =
  | 'verification_request'
  | 'timeout_warning'
  | 'completion'
  | 'dispute';

// ═══════════════════════════════════════════════════════════
// ATTESTATIONS
// ═══════════════════════════════════════════════════════════

export type AttestationType =
  | 'WALLET_OWNERSHIP'
  | 'FUNDS_THRESHOLD'
  | 'PREDICTION'
  | 'AGREEMENT'
  | 'OTHER';

export type AttestationStatus = 
  | 'PENDING' 
  | 'VALID' 
  | 'INVALID';
```

---

## Entity Interfaces

```typescript
// src/db/types.ts

// ═══════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════

export interface User {
  id: string;                  // UUID
  email: string | null;        // Optional, for notifications
  display_name: string | null;
  created_at: string;          // ISO timestamp
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════
// WALLETS
// ═══════════════════════════════════════════════════════════

export interface Wallet {
  id: string;
  user_id: string;
  wallet_address: string;      // Lowercase, no checksum
  network: string;             // e.g., "eip155:1", "solana-mainnet"
  is_primary: boolean;
  created_at: string;
  last_verified_at: string | null;
}

// ═══════════════════════════════════════════════════════════
// WALLET VERIFICATION CHALLENGES
// ═══════════════════════════════════════════════════════════

export interface WalletVerificationChallenge {
  id: string;
  user_id: string | null;      // Nullable for anonymous verification
  wallet_address: string;
  chain_id: string;            // e.g., "eip155:1"
  challenge_nonce: string;     // Random hex
  message: string;             // Full message to sign
  method: WalletVerificationMethod;
  status: WalletVerificationStatus;
  created_at: string;
  expires_at: string;
  verified_at: string | null;
  last_error: string | null;
}

// ═══════════════════════════════════════════════════════════
// CHALLENGES
// ═══════════════════════════════════════════════════════════

export interface Challenge {
  id: string;
  mode: ChallengeMode;
  creator_user_id: string;
  counterparty_user_id: string | null;  // Null for SOLO
  title: string;
  description: string | null;
  status: ChallengeStatus;
  intent_locked_at: string | null;
  expires_at: string | null;
  resolution_due_at: string | null;
  resolved_at: string | null;
  resolution_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Mode-specific config tables

export interface ChallengeFireConfig {
  challenge_id: string;
  honesty_bond_amount: string;  // Numeric as string (bigint safe)
  currency_code: string;
  resolution_strategy: 'ORACLE' | 'MODERATOR';
  oracle_source: string | null;
}

export interface ChallengeEnforcedConfig {
  challenge_id: string;
  accept_timeout_seconds: number;
  response_timeout_seconds: number;
  dispute_timeout_seconds: number;
}

// ═══════════════════════════════════════════════════════════
// FUNDS REQUIREMENTS & ATTESTATIONS
// ═══════════════════════════════════════════════════════════

export interface FundsRequirement {
  id: string;
  challenge_id: string;
  user_id: string;
  wallet_address: string;
  network: string;             // e.g., "eth-mainnet"
  asset_type: AssetType;
  token_address: string | null; // Null for native
  min_balance: string;         // Wei/satoshi/lamports as string
  currency_symbol: string;     // ETH, USDC, etc.
  snapshot_policy: SnapshotPolicy;
  created_at: string;
}

export interface FundsAttestation {
  id: string;
  funds_requirement_id: string;
  observed_balance: string | null;  // Null if not stored
  balance_hash: string;        // sha256(balance + salt)
  status: FundsCheckStatus;
  checked_at: string;
  check_phase: 'INTENT_LOCK' | 'FINALIZATION';
  provider: string;            // "alchemy", "quicknode", etc.
  raw_response: Record<string, unknown> | null;
}

export interface ZkProof {
  id: string;
  funds_attestation_id: string;
  proof_type: ZkProofType;
  proof_payload: Record<string, unknown>;
  status: 'VALID' | 'INVALID' | 'UNVERIFIED';
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// STAKES
// ═══════════════════════════════════════════════════════════

export interface Stake {
  id: string;
  challenge_id: string;
  user_id: string;
  amount: string;              // Smallest units as string
  currency_code: string;
  type: StakeType;
  status: StakeStatus;
  payment_provider: string;    // "stripe", "crypto"
  payment_reference: string;   // Stripe PI ID, tx hash, etc.
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════
// ATTESTATIONS
// ═══════════════════════════════════════════════════════════

export interface Attestation {
  id: string;
  challenge_id: string;
  user_id: string;
  type: AttestationType;
  status: AttestationStatus;
  payload: Record<string, unknown>;
  // Commitment chain (from v1)
  initiator_hash: string | null;  // I
  counter_hash: string | null;    // C
  final_hash: string | null;      // FINAL
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════

export interface WebhookEndpoint {
  id: string;
  user_id: string;
  url: string;
  secret: string;              // For HMAC signing
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  endpoint_id: string;
  event_type: WebhookEventType;
  payload: Record<string, unknown>;
  status: WebhookStatus;
  last_attempt_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

export interface Notification {
  id: string;
  user_id: string;
  challenge_id: string | null;
  type: NotificationType;
  template_key: NotificationTemplateKey;
  status: NotificationStatus;
  payload: Record<string, unknown>;  // Rendered content
  error: string | null;
  created_at: string;
  sent_at: string | null;
}
```

---

## API Request/Response Types

```typescript
// src/gatekeeper/types.ts

// ═══════════════════════════════════════════════════════════
// WALLET CHALLENGE
// ═══════════════════════════════════════════════════════════

export interface WalletChallengeRequest {
  wallet_address: string;
  chain_id: string;            // e.g., "eip155:1"
  user_id?: string;            // Optional, for linking
}

export interface WalletChallengeResponse {
  challenge_id: string;
  message: string;             // Message to sign
  expires_at: string;          // ISO timestamp
}

export interface WalletVerifyRequest {
  challenge_id: string;
  signature: string;           // Hex signature
}

export interface WalletVerifyResponse {
  status: WalletVerificationStatus;
  wallet_address: string;
  verified_at: string | null;
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// FUNDS CHECK
// ═══════════════════════════════════════════════════════════

export interface FundsCheckRequest {
  wallet_address: string;
  network: string;
  asset_type: AssetType;
  token_address?: string;      // Required for ERC20
  min_balance: string;
  challenge_id?: string;       // Link to challenge
  user_id?: string;
}

export interface FundsCheckResponse {
  status: FundsCheckStatus;
  proof_type: ZkProofType;
  provider: string;
  checked_at: string;
  // Privacy: no balance exposed
}

// ═══════════════════════════════════════════════════════════
// CHALLENGES
// ═══════════════════════════════════════════════════════════

export interface CreateChallengeRequest {
  mode: ChallengeMode;
  title: string;
  description?: string;
  counterparty_user_id?: string;
  expires_at?: string;
  
  // Mode-specific config
  fire_config?: {
    honesty_bond_amount: string;
    currency_code: string;
    resolution_strategy: 'ORACLE' | 'MODERATOR';
    oracle_source?: string;
  };
  
  enforced_config?: {
    accept_timeout_seconds?: number;
    response_timeout_seconds?: number;
    dispute_timeout_seconds?: number;
  };
  
  // Gatekeeper requirements
  gatekeeper_requirements?: {
    creator?: GatekeeperRequirement;
    counterparty?: GatekeeperRequirement;
  };
}

export interface GatekeeperRequirement {
  wallet_address: string;
  network: string;
  funds_checks?: Array<{
    asset_type: AssetType;
    token_address?: string;
    min_balance: string;
    currency_symbol: string;
  }>;
}

export interface ChallengeResponse {
  id: string;
  mode: ChallengeMode;
  status: ChallengeStatus;
  title: string;
  description: string | null;
  creator_user_id: string;
  counterparty_user_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  
  // Commitment hashes (when available)
  initiator_hash?: string;
  counter_hash?: string;
  final_hash?: string;
}

export interface AcceptChallengeRequest {
  // For Gatekeeper mode
  wallet_address?: string;
}

export interface ResolveChallengeRequest {
  outcome: 'CREATOR_WIN' | 'COUNTERPARTY_WIN' | 'DRAW' | 'NO_CONTEST';
  resolution_data?: Record<string, unknown>;
}
```

---

## Webhook Payload Types

```typescript
// src/relay/types.ts

export interface WebhookPayload {
  id: string;                  // Event ID
  type: WebhookEventType;
  created_at: string;
  mode: ChallengeMode;
  challenge: {
    id: string;
    status: ChallengeStatus;
    title: string;
    expires_at: string | null;
  };
  participants: Array<{
    role: 'creator' | 'counterparty';
    user_id: string;
    wallet_address?: string;
  }>;
  metadata?: Record<string, unknown>;
}

// Specific event payloads

export interface GatekeeperVerificationRequiredPayload extends WebhookPayload {
  type: 'challenge.gatekeeper_verification_required';
  metadata: {
    callback_url: string;
    funds_requirements: Array<{
      network: string;
      asset_type: AssetType;
      currency_symbol: string;
      min_balance: string;
    }>;
  };
}

export interface StakeSlashedPayload extends WebhookPayload {
  type: 'stake.slashed';
  metadata: {
    slashed_user_id: string;
    amount: string;
    currency_code: string;
    reason: string;
    distribution: {
      challenger: string;
      burn: string;
      treasury: string;
      provers: string;
    };
  };
}
```

---

## Environment Types

```typescript
// worker-configuration.d.ts (extend existing)

interface Env {
  // Existing KV bindings
  TATTLEHASH_KV: KVNamespace;
  TATTLEHASH_CONTENT_KV: KVNamespace;
  TATTLEHASH_ANCHOR_KV: KVNamespace;
  TATTLEHASH_ERROR_KV: KVNamespace;
  ATT_KV: KVNamespace;
  GATE_KV: KVNamespace;
  SHIELD_KV: KVNamespace;
  
  // NEW: D1 database
  TATTLEHASH_DB: D1Database;
  
  // Existing queue
  TATTLEHASH_QUEUE: Queue;
  
  // Existing Durable Object
  AnchorLock: DurableObjectNamespace;
  
  // Existing env vars
  TATTLEHASH_BRAND_NAME: string;
  ANCHOR_MODE: string;
  NODE_ENV: string;
  HMAC_SECRET: string;
  
  // RPC endpoints
  RPC_ETH_MAIN: string;
  RPC_BASE_MAIN: string;
  WEB3_RPC_URL_POLYGON: string;
  
  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_FAKE?: string;
  
  // NEW: Feature flags
  FF_GATEKEEPER_V2?: string;
  FF_FIRE_MODE?: string;
  FF_ENFORCED_MODE?: string;
  FF_WEBHOOKS?: string;
  
  // NEW: Notification services
  RESEND_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}
```

---

## Utility Types

```typescript
// src/types.ts (add to existing)

// Result type for operations that can fail
export type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

// Pagination
export interface PaginationParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    next_cursor?: string;
  };
}

// API Error
export interface ApiError {
  code: string;           // E.g., "E1001"
  status: number;         // HTTP status
  message: string;
  details?: Record<string, unknown>;
}
```
