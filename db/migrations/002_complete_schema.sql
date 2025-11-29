-- Complete TattleHash Gatekeeper v2 Schema

-- Challenges table
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('SOLO', 'GATEKEEPER', 'FIRE', 'ENFORCED')),
  creator_user_id TEXT NOT NULL,
  counterparty_user_id TEXT,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'AWAITING_COUNTERPARTY', 'INTENT_LOCKED', 'AWAITING_RESOLUTION', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at TEXT,
  intent_locked_at INTEGER,
  resolved_at INTEGER
);

-- Wallet Challenges (for EIP-191 verification)
CREATE TABLE IF NOT EXISTS wallet_challenges (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Webhook Deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES webhooks(id)
);

-- Challenge Disputes
CREATE TABLE IF NOT EXISTS challenge_disputes (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  raised_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RESOLVED')),
  winner_user_id TEXT,
  resolution TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Funds Requirements
CREATE TABLE IF NOT EXISTS funds_requirements (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('NATIVE', 'ERC20')),
  token_address TEXT,
  min_balance TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  snapshot_policy TEXT NOT NULL CHECK (snapshot_policy IN ('AT_CREATION', 'AT_INTENT_LOCK', 'AT_COMPLETION')),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- FIRE Mode Config
CREATE TABLE IF NOT EXISTS challenges_fire_config (
  challenge_id TEXT PRIMARY KEY,
  honesty_bond_amount TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  resolution_strategy TEXT NOT NULL CHECK (resolution_strategy IN ('ORACLE', 'MAJORITY_VOTE', 'ADMIN')),
  oracle_source TEXT,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- ENFORCED Mode Config
CREATE TABLE IF NOT EXISTS challenges_enforced_config (
  challenge_id TEXT PRIMARY KEY,
  accept_timeout_seconds INTEGER NOT NULL,
  response_timeout_seconds INTEGER NOT NULL,
  dispute_timeout_seconds INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Bond Deposits (for FIRE mode)
CREATE TABLE IF NOT EXISTS bond_deposits (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  tx_hash TEXT,
  deposited_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'RELEASED', 'FORFEITED')),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_counterparty ON challenges(counterparty_user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_created ON challenges(created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_wallet ON wallet_challenges(wallet_address);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_disputes_challenge ON challenge_disputes(challenge_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON challenge_disputes(status);
CREATE INDEX IF NOT EXISTS idx_funds_requirements_challenge ON funds_requirements(challenge_id);
