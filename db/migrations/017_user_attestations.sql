-- User Attestations: Track attestations per user
-- Allows users to see their attestation history in the dashboard

CREATE TABLE IF NOT EXISTS user_attestations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE,
    content_hash TEXT,
    anchor_status TEXT DEFAULT 'PENDING',
    anchor_tx_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_attestations_user_id ON user_attestations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_attestations_created_at ON user_attestations(created_at);
