-- Migration: Add AWAITING_GATEKEEPER status to challenges table
-- This status is used when a challenge is waiting for gatekeeper verification

-- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table
-- First, create a new table with the updated constraint

CREATE TABLE challenges_new (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('SOLO', 'GATEKEEPER', 'FIRE', 'ENFORCED')),
  creator_user_id TEXT NOT NULL,
  counterparty_user_id TEXT,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT',
    'AWAITING_COUNTERPARTY',
    'AWAITING_GATEKEEPER',
    'INTENT_LOCKED',
    'AWAITING_RESOLUTION',
    'DISPUTED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at TEXT,
  intent_locked_at INTEGER,
  resolved_at INTEGER
);

-- Copy data from old table
INSERT INTO challenges_new SELECT * FROM challenges;

-- Drop old table
DROP TABLE challenges;

-- Rename new table
ALTER TABLE challenges_new RENAME TO challenges;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_counterparty ON challenges(counterparty_user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_created ON challenges(created_at);
