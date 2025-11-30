-- Enforced Mode: Stakes and Threshold Configuration
-- Migration 005: Add full escrow support for ENFORCED mode

-- Stakes table - Tracks escrowed funds for ENFORCED mode
CREATE TABLE IF NOT EXISTS stakes (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount TEXT NOT NULL,              -- Amount in wei/smallest unit
  currency_code TEXT NOT NULL,       -- ETH, USDC, etc.
  chain_id TEXT NOT NULL,            -- eip155:1, eip155:137, etc.
  token_address TEXT,                -- NULL for native, contract for ERC20
  deposit_tx_hash TEXT,              -- On-chain tx proof
  release_tx_hash TEXT,              -- Set when released
  status TEXT NOT NULL CHECK (status IN (
    'PENDING',      -- Awaiting deposit confirmation
    'CONFIRMED',    -- Deposit confirmed on-chain
    'HELD',         -- In escrow, locked
    'RELEASED',     -- Released to original depositor
    'TRANSFERRED',  -- Transferred to counterparty (dispute resolution)
    'SLASHED'       -- Forfeited due to violation
  )),
  deposited_at INTEGER,
  confirmed_at INTEGER,
  released_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Enforced Threshold Configuration - Exact requirements per challenge
CREATE TABLE IF NOT EXISTS enforced_thresholds (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,

  -- USD Value Thresholds
  min_usd_value TEXT NOT NULL,              -- Minimum transaction value in USD
  max_usd_value TEXT,                       -- Maximum transaction value (NULL = no max)

  -- Blockchain Confirmation Requirements
  required_confirmations INTEGER NOT NULL DEFAULT 12,  -- Blocks to wait

  -- Allowed Chains/Assets (JSON arrays)
  allowed_chains TEXT NOT NULL,             -- ["eip155:1", "eip155:137"]
  allowed_assets TEXT NOT NULL,             -- ["ETH", "USDC", "USDT"]

  -- Time Constraints
  deal_expiry_at TEXT,                      -- Hard deadline for deal completion

  -- Stake Requirements
  creator_stake_required TEXT NOT NULL,     -- Required stake from creator
  counterparty_stake_required TEXT NOT NULL, -- Required stake from counterparty
  stake_currency TEXT NOT NULL,             -- Currency for stakes

  created_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Traffic Light State History - Audit trail of state changes
CREATE TABLE IF NOT EXISTS traffic_light_states (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('GREEN', 'YELLOW', 'RED')),
  reason TEXT NOT NULL,                     -- Why this state
  details TEXT,                             -- JSON with verification details
  evaluated_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Stake Events - Full audit trail
CREATE TABLE IF NOT EXISTS stake_events (
  id TEXT PRIMARY KEY,
  stake_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DEPOSIT_INITIATED',
    'DEPOSIT_CONFIRMED',
    'LOCKED',
    'RELEASE_INITIATED',
    'RELEASED',
    'TRANSFER_INITIATED',
    'TRANSFERRED',
    'SLASH_INITIATED',
    'SLASHED'
  )),
  tx_hash TEXT,
  details TEXT,                             -- JSON with event details
  created_at INTEGER NOT NULL,
  FOREIGN KEY (stake_id) REFERENCES stakes(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stakes_challenge ON stakes(challenge_id);
CREATE INDEX IF NOT EXISTS idx_stakes_user ON stakes(user_id);
CREATE INDEX IF NOT EXISTS idx_stakes_status ON stakes(status);
CREATE INDEX IF NOT EXISTS idx_enforced_thresholds_challenge ON enforced_thresholds(challenge_id);
CREATE INDEX IF NOT EXISTS idx_traffic_light_challenge ON traffic_light_states(challenge_id);
CREATE INDEX IF NOT EXISTS idx_stake_events_stake ON stake_events(stake_id);
CREATE INDEX IF NOT EXISTS idx_stake_events_type ON stake_events(event_type);

-- Update challenges_enforced_config to add threshold reference
ALTER TABLE challenges_enforced_config ADD COLUMN threshold_id TEXT REFERENCES enforced_thresholds(id);
ALTER TABLE challenges_enforced_config ADD COLUMN traffic_light_state TEXT DEFAULT 'YELLOW' CHECK (traffic_light_state IN ('GREEN', 'YELLOW', 'RED'));
ALTER TABLE challenges_enforced_config ADD COLUMN last_evaluation_at INTEGER;
