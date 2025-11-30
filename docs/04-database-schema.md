# Database Schema

> D1 (SQLite) schema for TattleHash relational data.  
> KV continues to handle nonces, idempotency, rate limiting, and cached receipts.

---

## Setup

```bash
# Create the D1 database
wrangler d1 create tattlehash-db

# Note the database_id from output, add to wrangler.toml:
# [[d1_databases]]
# binding = "TATTLEHASH_DB"
# database_name = "tattlehash-db"
# database_id = "<your-database-id>"

# Run migrations locally
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql

# Run migrations in production
wrangler d1 execute tattlehash-db --file=db/migrations/001_initial.sql
```

---

## Migration 001: Initial Schema

```sql
-- db/migrations/001_initial.sql
-- TattleHash Initial Schema
-- Created: November 2025

-- ═══════════════════════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);

-- ═══════════════════════════════════════════════════════════
-- WALLETS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_verified_at TEXT,
  
  UNIQUE(user_id, wallet_address, network)
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_address ON wallets(wallet_address);

-- ═══════════════════════════════════════════════════════════
-- WALLET VERIFICATION CHALLENGES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wallet_verification_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  challenge_nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'EIP191',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  last_error TEXT,
  
  CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED')),
  CHECK (method IN ('EIP191', 'EIP712', 'DUST_TX'))
);

CREATE INDEX idx_wallet_challenges_address ON wallet_verification_challenges(wallet_address);
CREATE INDEX idx_wallet_challenges_status ON wallet_verification_challenges(status);

-- ═══════════════════════════════════════════════════════════
-- CHALLENGES (Core table)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  counterparty_user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  intent_locked_at TEXT,
  expires_at TEXT,
  resolution_due_at TEXT,
  resolved_at TEXT,
  resolution_payload TEXT, -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (mode IN ('SOLO', 'FIRE', 'GATEKEEPER', 'ENFORCED')),
  CHECK (status IN (
    'DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER',
    'INTENT_LOCKED', 'ACTIVE', 'AWAITING_RESOLUTION',
    'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED'
  ))
);

CREATE INDEX idx_challenges_creator ON challenges(creator_user_id);
CREATE INDEX idx_challenges_counterparty ON challenges(counterparty_user_id);
CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_mode ON challenges(mode);

-- ═══════════════════════════════════════════════════════════
-- CHALLENGE MODE CONFIGS
-- ═══════════════════════════════════════════════════════════

-- Fire Mode Config
CREATE TABLE IF NOT EXISTS challenges_fire_config (
  challenge_id TEXT PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  honesty_bond_amount TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  resolution_strategy TEXT NOT NULL DEFAULT 'ORACLE',
  oracle_source TEXT,
  
  CHECK (resolution_strategy IN ('ORACLE', 'MODERATOR'))
);

-- Enforced Mode Config (user-configurable timeouts)
CREATE TABLE IF NOT EXISTS challenges_enforced_config (
  challenge_id TEXT PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  accept_timeout_seconds INTEGER NOT NULL DEFAULT 900,
  response_timeout_seconds INTEGER NOT NULL DEFAULT 86400,
  dispute_timeout_seconds INTEGER NOT NULL DEFAULT 259200,
  
  CHECK (accept_timeout_seconds BETWEEN 60 AND 604800),
  CHECK (response_timeout_seconds BETWEEN 300 AND 2592000),
  CHECK (dispute_timeout_seconds BETWEEN 3600 AND 2592000)
);

-- ═══════════════════════════════════════════════════════════
-- FUNDS REQUIREMENTS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS funds_requirements (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  token_address TEXT, -- NULL for native assets
  min_balance TEXT NOT NULL, -- Numeric string (wei, satoshi, etc.)
  currency_symbol TEXT NOT NULL,
  snapshot_policy TEXT NOT NULL DEFAULT 'AT_INTENT_LOCK',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (asset_type IN ('NATIVE', 'ERC20', 'BTC', 'SPL')),
  CHECK (snapshot_policy IN ('AT_INTENT_LOCK', 'AT_FINALIZATION', 'BOTH'))
);

CREATE INDEX idx_funds_requirements_challenge ON funds_requirements(challenge_id);

-- ═══════════════════════════════════════════════════════════
-- FUNDS ATTESTATIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS funds_attestations (
  id TEXT PRIMARY KEY,
  funds_requirement_id TEXT NOT NULL REFERENCES funds_requirements(id) ON DELETE CASCADE,
  observed_balance TEXT, -- NULL if not stored for privacy
  balance_hash TEXT NOT NULL, -- sha256(balance + salt)
  status TEXT NOT NULL DEFAULT 'PENDING',
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  check_phase TEXT NOT NULL,
  provider TEXT NOT NULL,
  raw_response TEXT, -- JSON, optional debug data
  
  CHECK (status IN ('PENDING', 'PASSED', 'FAILED', 'ERROR')),
  CHECK (check_phase IN ('INTENT_LOCK', 'FINALIZATION'))
);

CREATE INDEX idx_funds_attestations_requirement ON funds_attestations(funds_requirement_id);

-- ═══════════════════════════════════════════════════════════
-- ZK PROOFS (for future expansion)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS zk_proofs (
  id TEXT PRIMARY KEY,
  funds_attestation_id TEXT NOT NULL REFERENCES funds_attestations(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL DEFAULT 'OPAQUE_V1',
  proof_payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (proof_type IN ('OPAQUE_V1', 'SNARK', 'STARK', 'SEMAPHORE')),
  CHECK (status IN ('VALID', 'INVALID', 'UNVERIFIED'))
);

-- ═══════════════════════════════════════════════════════════
-- STAKES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stakes (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount TEXT NOT NULL, -- Numeric string
  currency_code TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD',
  payment_provider TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (type IN ('BASE', 'HONESTY_BOND')),
  CHECK (status IN ('HELD', 'RELEASED', 'SLASHED', 'REFUNDED'))
);

CREATE INDEX idx_stakes_challenge ON stakes(challenge_id);
CREATE INDEX idx_stakes_user ON stakes(user_id);

-- ═══════════════════════════════════════════════════════════
-- ATTESTATIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payload TEXT NOT NULL, -- JSON
  initiator_hash TEXT, -- I
  counter_hash TEXT,   -- C
  final_hash TEXT,     -- FINAL
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (type IN ('WALLET_OWNERSHIP', 'FUNDS_THRESHOLD', 'PREDICTION', 'AGREEMENT', 'OTHER')),
  CHECK (status IN ('PENDING', 'VALID', 'INVALID'))
);

CREATE INDEX idx_attestations_challenge ON attestations(challenge_id);
CREATE INDEX idx_attestations_final_hash ON attestations(final_hash);

-- ═══════════════════════════════════════════════════════════
-- WEBHOOK ENDPOINTS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_webhook_endpoints_user ON webhook_endpoints(user_id);

-- ═══════════════════════════════════════════════════════════
-- WEBHOOK EVENTS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_attempt_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED'))
);

CREATE INDEX idx_webhook_events_endpoint ON webhook_events(endpoint_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(status);
CREATE INDEX idx_webhook_events_next_attempt ON webhook_events(next_attempt_at);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  payload TEXT NOT NULL, -- JSON
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  
  CHECK (type IN ('EMAIL', 'SMS')),
  CHECK (status IN ('QUEUED', 'SENT', 'FAILED'))
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
```

---

## Migration 002: Indexes and Optimizations

```sql
-- db/migrations/002_indexes.sql
-- Additional indexes for query optimization

-- Composite index for challenge lookups
CREATE INDEX IF NOT EXISTS idx_challenges_status_mode 
  ON challenges(status, mode);

-- Index for finding pending webhook retries
CREATE INDEX IF NOT EXISTS idx_webhook_events_pending_retry 
  ON webhook_events(status, next_attempt_at) 
  WHERE status = 'PENDING';

-- Index for expiring challenges
CREATE INDEX IF NOT EXISTS idx_challenges_expires 
  ON challenges(expires_at) 
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');

-- Index for wallet verification by nonce (fast lookup)
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_nonce 
  ON wallet_verification_challenges(challenge_nonce);
```

---

## D1 Query Helpers

```typescript
// src/db/index.ts

import { D1Database } from '@cloudflare/workers-types';

export type DB = D1Database;

/**
 * Execute a single query and return all results
 */
export async function query<T>(
  db: DB,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results;
}

/**
 * Execute a single query and return first result
 */
export async function queryOne<T>(
  db: DB,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first<T>();
  return result ?? null;
}

/**
 * Execute an INSERT/UPDATE/DELETE and return changes
 */
export async function execute(
  db: DB,
  sql: string,
  params: unknown[] = []
): Promise<{ changes: number; lastRowId: number }> {
  const result = await db.prepare(sql).bind(...params).run();
  return {
    changes: result.meta.changes,
    lastRowId: result.meta.last_row_id,
  };
}

/**
 * Execute multiple statements in a batch
 */
export async function batch(
  db: DB,
  statements: Array<{ sql: string; params?: unknown[] }>
): Promise<void> {
  const prepared = statements.map(({ sql, params = [] }) =>
    db.prepare(sql).bind(...params)
  );
  await db.batch(prepared);
}

/**
 * Generate a UUID for primary keys
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}
```

---

## Entity-Specific Queries

```typescript
// src/db/challenges.ts

import { DB, query, queryOne, execute, generateId, now } from './index';
import type { Challenge, CreateChallengeRequest } from '../challenges/types';

export async function createChallenge(
  db: DB,
  data: CreateChallengeRequest & { creator_user_id: string }
): Promise<Challenge> {
  const id = generateId();
  const timestamp = now();
  
  await execute(
    db,
    `INSERT INTO challenges (
      id, mode, creator_user_id, counterparty_user_id,
      title, description, status, expires_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.mode,
      data.creator_user_id,
      data.counterparty_user_id ?? null,
      data.title,
      data.description ?? null,
      'DRAFT',
      data.expires_at ?? null,
      timestamp,
      timestamp,
    ]
  );
  
  return getChallengeById(db, id) as Promise<Challenge>;
}

export async function getChallengeById(
  db: DB,
  id: string
): Promise<Challenge | null> {
  return queryOne<Challenge>(
    db,
    'SELECT * FROM challenges WHERE id = ?',
    [id]
  );
}

export async function updateChallengeStatus(
  db: DB,
  id: string,
  status: string,
  additionalFields?: Record<string, unknown>
): Promise<void> {
  const sets = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now()];
  
  if (additionalFields) {
    for (const [key, value] of Object.entries(additionalFields)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  
  params.push(id);
  
  await execute(
    db,
    `UPDATE challenges SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
}

export async function getChallengesByUser(
  db: DB,
  userId: string,
  limit = 50,
  offset = 0
): Promise<Challenge[]> {
  return query<Challenge>(
    db,
    `SELECT * FROM challenges 
     WHERE creator_user_id = ? OR counterparty_user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, limit, offset]
  );
}
```

---

## KV Usage (Unchanged)

KV namespaces continue to handle:

| Key Pattern | Namespace | TTL | Purpose |
|-------------|-----------|-----|---------|
| `nonce:{id}` | GATE_KV | 15 min | Wallet challenge nonces |
| `idem:{key}` | GATE_KV | 1 hour | Idempotency keys |
| `rate:{user}:{window}` | GATE_KV | 1 min | Rate limiting |
| `receipt:{id}` | GATE_KV | 2 days | Cached receipts |
| `gate:{id}` | GATE_KV | 2 days | v1 gate records |

D1 is the source of truth; KV is for speed and ephemeral data.
