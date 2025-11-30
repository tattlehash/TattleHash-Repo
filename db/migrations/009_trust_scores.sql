-- Trust Score System Tables
-- Real-time risk assessment for wallet addresses

-- Main trust scores table (cached scores with TTL)
CREATE TABLE IF NOT EXISTS trust_scores (
  id TEXT PRIMARY KEY,

  -- Wallet identification
  wallet_address TEXT NOT NULL UNIQUE,
  wallet_address_lower TEXT NOT NULL, -- Lowercase for case-insensitive lookups

  -- Core score
  trust_score INTEGER NOT NULL CHECK (trust_score >= 0 AND trust_score <= 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Score breakdown (JSON)
  factors TEXT NOT NULL, -- JSON: detailed breakdown of each factor
  flags TEXT, -- JSON: array of warning flags

  -- Data availability metrics
  data_points_available INTEGER NOT NULL DEFAULT 0,
  data_points_total INTEGER NOT NULL DEFAULT 5,

  -- Cache management
  cache_ttl INTEGER NOT NULL DEFAULT 3600, -- Seconds
  expires_at INTEGER NOT NULL,

  -- Timestamps
  first_seen_at INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  last_calculated_at INTEGER NOT NULL
);

-- Trust score history for trending analysis
CREATE TABLE IF NOT EXISTS trust_score_history (
  id TEXT PRIMARY KEY,

  -- Reference
  wallet_address TEXT NOT NULL,
  trust_score_id TEXT NOT NULL,

  -- Score snapshot
  trust_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  confidence REAL NOT NULL,
  factors TEXT NOT NULL, -- JSON snapshot
  flags TEXT, -- JSON snapshot

  -- What triggered recalculation
  trigger_reason TEXT CHECK (trigger_reason IN (
    'INITIAL', 'SCHEDULED', 'TRANSACTION', 'DISPUTE',
    'VERIFICATION', 'MANUAL', 'FLAG_CHANGE', 'CACHE_EXPIRED'
  )),

  -- Timestamps
  calculated_at INTEGER NOT NULL
);

-- Flagged wallets and reasons
CREATE TABLE IF NOT EXISTS wallet_flags (
  id TEXT PRIMARY KEY,

  -- Wallet identification
  wallet_address TEXT NOT NULL,
  wallet_address_lower TEXT NOT NULL,

  -- Flag details
  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'WALLET_NEW', 'LIMITED_HISTORY', 'DISPUTE_HISTORY',
    'VERIFICATION_FAILED', 'FLAGGED_CONNECTIONS', 'PATTERN_ANOMALY',
    'SCAM_REPORT', 'MANUAL_FLAG'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),

  -- Content
  description TEXT NOT NULL,
  evidence TEXT, -- JSON: supporting data

  -- Source
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'USER_REPORT', 'LLM_ANALYSIS', 'EXTERNAL', 'ADMIN')),
  reported_by_user_id TEXT,

  -- Resolution
  active INTEGER NOT NULL DEFAULT 1,
  resolved_at INTEGER,
  resolved_by_user_id TEXT,
  resolution_notes TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Wallet transaction stats (aggregated for performance)
CREATE TABLE IF NOT EXISTS wallet_stats (
  wallet_address TEXT PRIMARY KEY,
  wallet_address_lower TEXT NOT NULL UNIQUE,

  -- Activity stats
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_challenges_created INTEGER NOT NULL DEFAULT 0,
  total_challenges_received INTEGER NOT NULL DEFAULT 0,
  total_enf_bundles_sent INTEGER NOT NULL DEFAULT 0,
  total_enf_bundles_received INTEGER NOT NULL DEFAULT 0,

  -- Dispute stats
  disputes_raised INTEGER NOT NULL DEFAULT 0,
  disputes_received INTEGER NOT NULL DEFAULT 0,
  disputes_won INTEGER NOT NULL DEFAULT 0,
  disputes_lost INTEGER NOT NULL DEFAULT 0,

  -- Verification stats
  gatekeeper_verifications INTEGER NOT NULL DEFAULT 0,
  last_verification_status TEXT CHECK (last_verification_status IN ('PASSED', 'FAILED', 'PENDING')),
  last_verification_at INTEGER,

  -- Network analysis
  unique_counterparties INTEGER NOT NULL DEFAULT 0,
  flagged_counterparty_count INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  first_seen_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  stats_updated_at INTEGER NOT NULL
);

-- Network connections between wallets (for network analysis)
CREATE TABLE IF NOT EXISTS wallet_connections (
  id TEXT PRIMARY KEY,

  -- Connection
  wallet_a TEXT NOT NULL,
  wallet_b TEXT NOT NULL,

  -- Relationship type
  connection_type TEXT NOT NULL CHECK (connection_type IN (
    'CHALLENGE_CREATOR', 'CHALLENGE_COUNTERPARTY',
    'ENF_SENDER', 'ENF_RECIPIENT',
    'DISPUTE_OPPONENT'
  )),

  -- Stats
  interaction_count INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  first_interaction_at INTEGER NOT NULL,
  last_interaction_at INTEGER NOT NULL,

  UNIQUE(wallet_a, wallet_b, connection_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trust_scores_wallet ON trust_scores(wallet_address_lower);
CREATE INDEX IF NOT EXISTS idx_trust_scores_expires ON trust_scores(expires_at);
CREATE INDEX IF NOT EXISTS idx_trust_scores_risk ON trust_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_trust_scores_score ON trust_scores(trust_score);

CREATE INDEX IF NOT EXISTS idx_trust_history_wallet ON trust_score_history(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trust_history_calculated ON trust_score_history(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_history_score_id ON trust_score_history(trust_score_id);

CREATE INDEX IF NOT EXISTS idx_wallet_flags_wallet ON wallet_flags(wallet_address_lower);
CREATE INDEX IF NOT EXISTS idx_wallet_flags_type ON wallet_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_wallet_flags_active ON wallet_flags(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_wallet_flags_severity ON wallet_flags(severity);

CREATE INDEX IF NOT EXISTS idx_wallet_stats_wallet ON wallet_stats(wallet_address_lower);
CREATE INDEX IF NOT EXISTS idx_wallet_stats_active ON wallet_stats(last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_connections_a ON wallet_connections(wallet_a);
CREATE INDEX IF NOT EXISTS idx_wallet_connections_b ON wallet_connections(wallet_b);
