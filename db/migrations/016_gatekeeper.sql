-- ============================================================================
-- Gatekeeper Mode Tables
--
-- Mutual verification with privacy-respecting asymmetry.
-- Users must verify themselves before using Gatekeeper.
-- Badge earned based on external signals (not TattleHash tenure).
-- ============================================================================

-- ============================================================================
-- Check Type Definitions (Modular)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_check_types (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,  -- 'crypto', 'professional', 'business', 'payment'
    name TEXT NOT NULL,
    description TEXT,
    method TEXT NOT NULL,  -- 'signature', 'api', 'oauth', 'lookup'
    oauth_provider TEXT,  -- For OAuth-based checks
    badge_required INTEGER DEFAULT 0,  -- 1 = must pass for badge
    badge_threshold TEXT,  -- JSON with threshold criteria
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Seed initial check types for Crypto profile
INSERT OR IGNORE INTO gatekeeper_check_types (id, category, name, description, method, badge_required, badge_threshold, sort_order) VALUES
('wallet_ownership', 'crypto', 'Wallet Ownership', 'Verify wallet ownership via EIP-191 signature', 'signature', 1, NULL, 1),
('balance_check', 'crypto', 'Balance Verification', 'Verify minimum balance on specified chain', 'api', 1, NULL, 2),
('wallet_age', 'crypto', 'Wallet Age', 'Check wallet creation date from first transaction', 'api', 1, '{"min_days": 30}', 3),
('tx_count', 'crypto', 'Transaction Count', 'Check total transaction count', 'api', 1, '{"min_count": 10}', 4),
('chainabuse', 'crypto', 'Community Reports', 'Check Chainabuse database for reports', 'lookup', 1, '{"max_reports": 0}', 5);

-- ============================================================================
-- Profile Presets
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    target_market TEXT,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Seed initial profiles
INSERT OR IGNORE INTO gatekeeper_profiles (id, name, description, target_market, sort_order) VALUES
('crypto_trade', 'Crypto Trade', 'Wallet ownership, balance, history verification', 'P2P, OTC', 1),
('freelance', 'Freelance Contract', 'Professional profile and portfolio verification', 'Creators, contractors', 2),
('business', 'Business Transaction', 'Business registration and domain verification', 'B2B, gig clients', 3);

-- ============================================================================
-- Profile to Check Mapping
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_profile_checks (
    profile_id TEXT NOT NULL,
    check_type_id TEXT NOT NULL,
    required INTEGER DEFAULT 0,  -- 1 = required for this profile
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (profile_id, check_type_id),
    FOREIGN KEY (profile_id) REFERENCES gatekeeper_profiles(id),
    FOREIGN KEY (check_type_id) REFERENCES gatekeeper_check_types(id)
);

-- Map checks to Crypto Trade profile
INSERT OR IGNORE INTO gatekeeper_profile_checks (profile_id, check_type_id, required, sort_order) VALUES
('crypto_trade', 'wallet_ownership', 1, 1),
('crypto_trade', 'balance_check', 1, 2),
('crypto_trade', 'wallet_age', 1, 3),
('crypto_trade', 'tx_count', 1, 4),
('crypto_trade', 'chainabuse', 1, 5);

-- ============================================================================
-- User Verification Status (for badge)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_user_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,

    -- Status
    status TEXT DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED
    signal_summary TEXT,  -- CLEAR, CAUTION, REVIEW_RECOMMENDED

    -- Badge
    badge_granted INTEGER DEFAULT 0,
    badge_reason TEXT,  -- Why badge was/wasn't granted

    -- Wallet info (for crypto profile)
    wallet_address TEXT,
    wallet_chain TEXT,

    -- Timing
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    verified_at INTEGER,
    expires_at INTEGER,  -- Re-verification required after (12 months)

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (profile_id) REFERENCES gatekeeper_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_gk_user_verifications_user ON gatekeeper_user_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_gk_user_verifications_status ON gatekeeper_user_verifications(status);

-- ============================================================================
-- User Verification Check Results
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_user_verification_checks (
    id TEXT PRIMARY KEY,
    user_verification_id TEXT NOT NULL,
    check_type_id TEXT NOT NULL,

    -- Status
    status TEXT DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED, FAILED

    -- Signal result
    signal_type TEXT,  -- 'positive', 'neutral', 'warning'
    signal_text TEXT,
    meets_badge_threshold INTEGER,  -- 1 = meets, 0 = doesn't meet

    -- Raw data (JSON)
    raw_data TEXT,

    -- Timing
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    checked_at INTEGER,

    FOREIGN KEY (user_verification_id) REFERENCES gatekeeper_user_verifications(id),
    FOREIGN KEY (check_type_id) REFERENCES gatekeeper_check_types(id)
);

CREATE INDEX IF NOT EXISTS idx_gk_user_checks_verification ON gatekeeper_user_verification_checks(user_verification_id);

-- ============================================================================
-- Gatekeeper Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_sessions (
    id TEXT PRIMARY KEY,

    -- Profile used
    profile_id TEXT NOT NULL,

    -- Status
    status TEXT DEFAULT 'PENDING',
    -- PENDING, COUNTERPARTY_INVITED, COUNTERPARTY_VERIFYING,
    -- VERIFIED, COMPLETED, ABORTED, EXPIRED

    -- Initiator (already verified via user_verifications)
    initiator_user_id TEXT NOT NULL,
    initiator_verification_id TEXT NOT NULL,
    initiator_badge_status INTEGER NOT NULL,  -- 1 = has badge, 0 = no badge

    -- Counterparty
    counterparty_email TEXT NOT NULL,
    counterparty_user_id TEXT,
    counterparty_verification_status TEXT DEFAULT 'PENDING',
    counterparty_signal_summary TEXT,
    counterparty_wallet_address TEXT,

    -- Requirements for counterparty
    title TEXT,
    description TEXT,
    required_chain TEXT DEFAULT 'ethereum',
    required_token TEXT DEFAULT 'ETH',
    required_balance TEXT,  -- Minimum balance in wei/smallest unit
    required_balance_display TEXT,  -- Human-readable balance

    -- Document (optional)
    content_hash TEXT,
    file_name TEXT,
    file_size INTEGER,
    file_type TEXT,

    -- Verification code for counterparty
    verification_code TEXT,
    verification_code_expires_at INTEGER,
    verification_attempts INTEGER DEFAULT 0,

    -- Attestation (if completed)
    attestation_id TEXT,

    -- Timing
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    expires_at INTEGER,
    completed_at INTEGER,
    aborted_at INTEGER,
    abort_reason TEXT,

    FOREIGN KEY (profile_id) REFERENCES gatekeeper_profiles(id),
    FOREIGN KEY (initiator_user_id) REFERENCES users(id),
    FOREIGN KEY (initiator_verification_id) REFERENCES gatekeeper_user_verifications(id)
);

CREATE INDEX IF NOT EXISTS idx_gk_sessions_initiator ON gatekeeper_sessions(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_gk_sessions_counterparty ON gatekeeper_sessions(counterparty_email);
CREATE INDEX IF NOT EXISTS idx_gk_sessions_status ON gatekeeper_sessions(status);

-- ============================================================================
-- Counterparty Check Results (per session)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_session_checks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    check_type_id TEXT NOT NULL,

    -- Status
    status TEXT DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED, FAILED

    -- Signal result
    signal_type TEXT,  -- 'positive', 'neutral', 'warning'
    signal_text TEXT,

    -- Raw data (JSON)
    raw_data TEXT,

    -- Timing
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    checked_at INTEGER,

    FOREIGN KEY (session_id) REFERENCES gatekeeper_sessions(id),
    FOREIGN KEY (check_type_id) REFERENCES gatekeeper_check_types(id)
);

CREATE INDEX IF NOT EXISTS idx_gk_session_checks_session ON gatekeeper_session_checks(session_id);

-- ============================================================================
-- Gatekeeper Events Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS gatekeeper_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    user_verification_id TEXT,

    event_type TEXT NOT NULL,
    -- USER_VERIFICATION_STARTED, USER_VERIFICATION_COMPLETED,
    -- SESSION_CREATED, COUNTERPARTY_INVITED, COUNTERPARTY_VERIFIED,
    -- CHECK_COMPLETED, SESSION_COMPLETED, SESSION_ABORTED

    actor_type TEXT,  -- 'INITIATOR', 'COUNTERPARTY', 'SYSTEM'
    actor_identifier TEXT,

    details TEXT,  -- JSON with additional context

    created_at INTEGER DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (session_id) REFERENCES gatekeeper_sessions(id),
    FOREIGN KEY (user_verification_id) REFERENCES gatekeeper_user_verifications(id)
);

CREATE INDEX IF NOT EXISTS idx_gk_events_session ON gatekeeper_events(session_id);
CREATE INDEX IF NOT EXISTS idx_gk_events_user_verification ON gatekeeper_events(user_verification_id);
CREATE INDEX IF NOT EXISTS idx_gk_events_type ON gatekeeper_events(event_type);
