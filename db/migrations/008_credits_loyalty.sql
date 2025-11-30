-- Credits & Loyalty System
-- Universal credit ledger for referrals, promotions, and loyalty rewards

-- ============================================================================
-- Loyalty Tiers Definition
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    tier TEXT PRIMARY KEY,                    -- BRONZE, SILVER, GOLD, PLATINUM
    display_name TEXT NOT NULL,
    min_transactions INTEGER NOT NULL,        -- Minimum lifetime transactions
    credit_back_percent REAL NOT NULL,        -- % credit back on transactions (0.0-1.0)
    credit_expiry_days INTEGER NOT NULL,      -- Days until loyalty credits expire
    perks TEXT,                               -- JSON array of perk descriptions
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================================
-- User Credits Summary
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY,

    -- Current balances (computed from credit_balances, cached here)
    total_available INTEGER NOT NULL DEFAULT 0,
    total_pending INTEGER NOT NULL DEFAULT 0,      -- Credits being held for active transactions

    -- Loyalty tracking
    loyalty_tier TEXT NOT NULL DEFAULT 'BRONZE',
    lifetime_transactions INTEGER NOT NULL DEFAULT 0,
    lifetime_credits_earned INTEGER NOT NULL DEFAULT 0,
    lifetime_credits_used INTEGER NOT NULL DEFAULT 0,

    -- Referral tracking
    referral_code TEXT UNIQUE,                     -- User's personal referral code
    referred_by_user_id TEXT,                      -- Who referred this user
    referral_coupons_available INTEGER NOT NULL DEFAULT 0,
    referral_coupons_sent INTEGER NOT NULL DEFAULT 0,
    referral_conversions INTEGER NOT NULL DEFAULT 0,  -- How many people completed paid transactions

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (loyalty_tier) REFERENCES loyalty_tiers(tier),
    FOREIGN KEY (referred_by_user_id) REFERENCES users(id)
);

-- ============================================================================
-- Individual Credit Balances (with expiration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_balances (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,

    -- Credit details
    credit_type TEXT NOT NULL,                -- REFERRAL_REWARD, PROMO, MILESTONE, LOYALTY
    amount INTEGER NOT NULL,                  -- Number of credits (positive = grant, can be partially used)
    remaining INTEGER NOT NULL,               -- Credits still available from this grant

    -- Source tracking
    source_type TEXT NOT NULL,                -- REFERRAL, PROMO_CODE, MILESTONE, LOYALTY_CASHBACK, ADMIN
    source_id TEXT,                           -- ID of referral, promo, etc.
    source_description TEXT,                  -- Human-readable description

    -- Expiration
    expires_at INTEGER NOT NULL,

    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE',    -- ACTIVE, EXHAUSTED, EXPIRED, CANCELLED

    -- Timestamps
    granted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    exhausted_at INTEGER,

    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_balances_user ON credit_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_balances_user_active ON credit_balances(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_credit_balances_expires ON credit_balances(expires_at) WHERE status = 'ACTIVE';

-- ============================================================================
-- Credit Events (Audit Log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,

    -- Event details
    event_type TEXT NOT NULL,                 -- GRANT, REDEEM, EXPIRE, CANCEL, REFUND, HOLD, RELEASE
    credit_type TEXT,                         -- Type of credit involved
    amount INTEGER NOT NULL,                  -- Positive for grants, negative for usage

    -- Balance tracking
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,

    -- Related entities
    credit_balance_id TEXT,                   -- Which credit balance was affected
    transaction_id TEXT,                      -- If used for a transaction
    promotion_id TEXT,                        -- If from a promotion
    referral_id TEXT,                         -- If from a referral

    -- Metadata
    description TEXT NOT NULL,
    metadata TEXT,                            -- JSON additional data

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (credit_balance_id) REFERENCES credit_balances(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_events_user ON credit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_events_user_time ON credit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_events_type ON credit_events(event_type);

-- ============================================================================
-- Promotions (Admin-created)
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY,

    -- Promotion details
    code TEXT UNIQUE NOT NULL,                -- Promo code users enter
    name TEXT NOT NULL,
    description TEXT,

    -- Credit grant
    credits_granted INTEGER NOT NULL,         -- How many credits to grant
    credit_type TEXT NOT NULL DEFAULT 'PROMO', -- Type of credits granted
    expiry_days INTEGER NOT NULL DEFAULT 14,  -- Days until granted credits expire

    -- Limits
    max_claims INTEGER,                       -- NULL = unlimited
    claims_count INTEGER NOT NULL DEFAULT 0,
    max_claims_per_user INTEGER NOT NULL DEFAULT 1,

    -- Eligibility
    new_users_only INTEGER NOT NULL DEFAULT 0,  -- 1 = only new users can claim
    min_tier TEXT,                            -- Minimum loyalty tier required

    -- Validity period
    starts_at INTEGER NOT NULL,
    ends_at INTEGER,                          -- NULL = no end date

    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE',    -- ACTIVE, PAUSED, EXPIRED, CANCELLED

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    created_by_user_id TEXT,                  -- Admin who created
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);

-- ============================================================================
-- Promotion Claims
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotion_claims (
    id TEXT PRIMARY KEY,
    promotion_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    -- Claim details
    credits_granted INTEGER NOT NULL,
    credit_balance_id TEXT NOT NULL,          -- The credit balance created

    -- Timestamps
    claimed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (promotion_id) REFERENCES promotions(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (credit_balance_id) REFERENCES credit_balances(id),
    UNIQUE (promotion_id, user_id)            -- One claim per user per promo
);

CREATE INDEX IF NOT EXISTS idx_promotion_claims_user ON promotion_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_promotion_claims_promo ON promotion_claims(promotion_id);

-- ============================================================================
-- Referral Coupons
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_coupons (
    id TEXT PRIMARY KEY,

    -- Sender
    sender_user_id TEXT NOT NULL,

    -- Coupon details
    coupon_code TEXT UNIQUE NOT NULL,         -- Unique code for this coupon
    recipient_email TEXT,                     -- Email sent to (optional)

    -- Status
    status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING, CLAIMED, EXPIRED, CANCELLED

    -- Claim tracking
    claimed_by_user_id TEXT,
    claimed_at INTEGER,

    -- Conversion tracking (did recipient complete paid transaction?)
    converted INTEGER NOT NULL DEFAULT 0,
    converted_at INTEGER,
    reward_granted INTEGER NOT NULL DEFAULT 0, -- Has sender received their reward?
    reward_granted_at INTEGER,

    -- Expiration
    expires_at INTEGER NOT NULL,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

    FOREIGN KEY (sender_user_id) REFERENCES users(id),
    FOREIGN KEY (claimed_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_referral_coupons_sender ON referral_coupons(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_coupons_code ON referral_coupons(coupon_code);
CREATE INDEX IF NOT EXISTS idx_referral_coupons_recipient ON referral_coupons(recipient_email);
CREATE INDEX IF NOT EXISTS idx_referral_coupons_status ON referral_coupons(status);

-- ============================================================================
-- Milestone Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_milestones (
    id TEXT PRIMARY KEY,

    -- Milestone details
    name TEXT NOT NULL,
    description TEXT,
    transaction_count INTEGER NOT NULL UNIQUE, -- Transactions needed to unlock
    credits_awarded INTEGER NOT NULL,

    -- Status
    active INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================================
-- User Milestone Progress
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_milestones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,

    -- Achievement details
    achieved_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    credits_awarded INTEGER NOT NULL,
    credit_balance_id TEXT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (milestone_id) REFERENCES credit_milestones(id),
    FOREIGN KEY (credit_balance_id) REFERENCES credit_balances(id),
    UNIQUE (user_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_user_milestones_user ON user_milestones(user_id);

-- ============================================================================
-- Credit Holds (for active transactions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_holds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,

    -- Hold details
    amount INTEGER NOT NULL,                  -- Credits held
    reason TEXT NOT NULL,                     -- TRANSACTION_PENDING, etc.

    -- Related entities
    transaction_id TEXT,
    challenge_id TEXT,

    -- Status
    status TEXT NOT NULL DEFAULT 'HELD',      -- HELD, RELEASED, APPLIED, EXPIRED

    -- Resolution
    resolved_at INTEGER,
    resolution_type TEXT,                     -- APPLIED, RELEASED, EXPIRED

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    expires_at INTEGER NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_holds_user ON credit_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_holds_status ON credit_holds(status);

-- ============================================================================
-- Insert Default Loyalty Tiers
-- ============================================================================

INSERT OR IGNORE INTO loyalty_tiers (tier, display_name, min_transactions, credit_back_percent, credit_expiry_days, perks) VALUES
    ('BRONZE', 'Bronze', 0, 0.0, 365, '["Basic support"]'),
    ('SILVER', 'Silver', 25, 0.02, 365, '["2% credit back", "Priority support"]'),
    ('GOLD', 'Gold', 100, 0.05, 365, '["5% credit back", "Priority support", "Early access to features"]'),
    ('PLATINUM', 'Platinum', 500, 0.10, 365, '["10% credit back", "Dedicated support", "Early access", "Beta features"]');

-- ============================================================================
-- Insert Default Milestones
-- ============================================================================

INSERT OR IGNORE INTO credit_milestones (id, name, description, transaction_count, credits_awarded) VALUES
    ('milestone-25', '25 Transactions', 'Complete 25 transactions', 25, 2),
    ('milestone-50', '50 Transactions', 'Complete 50 transactions', 50, 3),
    ('milestone-100', '100 Transactions', 'Complete 100 transactions', 100, 5),
    ('milestone-250', '250 Transactions', 'Complete 250 transactions', 250, 10),
    ('milestone-500', '500 Transactions', 'Complete 500 transactions', 500, 20),
    ('milestone-1000', '1000 Transactions', 'Complete 1000 transactions', 1000, 50);
