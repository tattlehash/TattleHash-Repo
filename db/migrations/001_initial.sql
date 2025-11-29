
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Challenges table
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  counterparty_wallet TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'INTENT_LOCKED', 'COMPLETED', 'CANCELLED')),
  mode TEXT NOT NULL CHECK (mode IN ('SOLO', 'GATEKEEPER', 'FIRE', 'ENFORCED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  metadata TEXT
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
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_challenges_counterparty ON challenges(counterparty_wallet);
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_wallet ON wallet_challenges(wallet_address);
