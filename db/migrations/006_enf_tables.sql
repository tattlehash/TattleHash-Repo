-- Migration: 006_enf_tables
-- Evidence-and-Forward (ENF) Tables
--
-- ENF provides court-admissible evidence bundling with
-- multi-party acknowledgment tracking and full audit trail.

-- ============================================================================
-- Core ENF Bundles
-- ============================================================================

CREATE TABLE IF NOT EXISTS enf_bundles (
    id TEXT PRIMARY KEY,
    initiator_user_id TEXT NOT NULL,
    initiator_wallet TEXT,

    -- Evidence content
    title TEXT NOT NULL,
    description TEXT,
    evidence_hash TEXT NOT NULL,          -- SHA256 of canonical evidence
    evidence_payload TEXT NOT NULL,       -- JSON evidence (court-admissible)

    -- Metadata
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT',           -- Created, not yet sent
        'SENT',            -- Forwarded to recipients
        'PARTIAL',         -- Some recipients responded
        'COMPLETE',        -- All recipients responded
        'EXPIRED',         -- TTL exceeded
        'CANCELLED'        -- Initiator cancelled
    )),

    -- Timing
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (initiator_user_id) REFERENCES users(id)
);

-- ============================================================================
-- ENF Recipients (one bundle can have multiple recipients)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enf_recipients (
    id TEXT PRIMARY KEY,
    enf_id TEXT NOT NULL,

    -- Recipient identification
    counterparty_type TEXT NOT NULL CHECK (counterparty_type IN (
        'EMAIL',           -- Email address
        'WALLET',          -- Blockchain wallet address
        'USER_ID'          -- Internal user ID
    )),
    counterparty_identifier TEXT NOT NULL,
    counterparty_user_id TEXT,            -- Resolved user ID if available

    -- Delivery
    delivery_token TEXT UNIQUE,           -- Secret token for action link
    delivery_link TEXT,                   -- Full URL sent to recipient

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING',         -- Awaiting delivery
        'SENT',            -- Delivery attempted
        'DELIVERED',       -- Confirmed delivered (email opened, etc.)
        'ACKNOWLEDGED',    -- Recipient signed/acknowledged
        'DECLINED',        -- Recipient explicitly declined
        'EXPIRED'          -- No response before expiry
    )),

    -- Response
    response_message TEXT,                -- Optional message from recipient

    -- Timing
    sent_at INTEGER,
    delivered_at INTEGER,
    responded_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (enf_id) REFERENCES enf_bundles(id) ON DELETE CASCADE,
    FOREIGN KEY (counterparty_user_id) REFERENCES users(id)
);

-- ============================================================================
-- ENF Signatures (cryptographic proof of acknowledgment)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enf_signatures (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL UNIQUE,

    -- Signature data
    signature_type TEXT NOT NULL CHECK (signature_type IN (
        'EIP191',          -- Ethereum personal_sign
        'EIP712',          -- Typed structured data
        'CLICK_ACK',       -- Simple click acknowledgment (non-crypto)
        'EMAIL_REPLY'      -- Email-based acknowledgment
    )),

    -- EIP-191/712 signature fields
    signature TEXT,                       -- Hex signature
    message_hash TEXT,                    -- Hash of signed message
    signer_address TEXT,                  -- Recovered address

    -- Verification
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_error TEXT,

    -- Timing
    signed_at INTEGER NOT NULL,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,

    FOREIGN KEY (recipient_id) REFERENCES enf_recipients(id) ON DELETE CASCADE
);

-- ============================================================================
-- ENF Audit Trail (immutable event log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enf_events (
    id TEXT PRIMARY KEY,
    enf_id TEXT NOT NULL,
    recipient_id TEXT,                    -- NULL for bundle-level events

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN (
        'CREATED',         -- Bundle created
        'UPDATED',         -- Bundle modified
        'SENT',            -- Forwarded to recipient
        'DELIVERED',       -- Delivery confirmed
        'VIEWED',          -- Recipient viewed evidence
        'ACKNOWLEDGED',    -- Recipient acknowledged
        'SIGNED',          -- Cryptographic signature added
        'DECLINED',        -- Recipient declined
        'EXPIRED',         -- TTL exceeded
        'CANCELLED',       -- Initiator cancelled
        'DISPUTED',        -- Dispute raised
        'REMINDER_SENT'    -- Follow-up reminder sent
    )),

    -- Actor information
    actor_type TEXT NOT NULL CHECK (actor_type IN (
        'INITIATOR',       -- The person who created ENF
        'RECIPIENT',       -- A counterparty
        'SYSTEM'           -- Automated action
    )),
    actor_identifier TEXT,                -- user_id, email, wallet, or 'system'

    -- Event context
    details TEXT,                         -- JSON with additional context
    ip_address TEXT,                      -- For audit purposes
    user_agent TEXT,                      -- For audit purposes

    -- Timing (immutable - no updated_at)
    created_at INTEGER NOT NULL,

    FOREIGN KEY (enf_id) REFERENCES enf_bundles(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES enf_recipients(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Bundle lookups
CREATE INDEX IF NOT EXISTS idx_enf_bundles_initiator ON enf_bundles(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_enf_bundles_status ON enf_bundles(status);
CREATE INDEX IF NOT EXISTS idx_enf_bundles_expires ON enf_bundles(expires_at);
CREATE INDEX IF NOT EXISTS idx_enf_bundles_created ON enf_bundles(created_at);

-- Recipient lookups
CREATE INDEX IF NOT EXISTS idx_enf_recipients_enf ON enf_recipients(enf_id);
CREATE INDEX IF NOT EXISTS idx_enf_recipients_status ON enf_recipients(status);
CREATE INDEX IF NOT EXISTS idx_enf_recipients_token ON enf_recipients(delivery_token);
CREATE INDEX IF NOT EXISTS idx_enf_recipients_identifier ON enf_recipients(counterparty_identifier);
CREATE INDEX IF NOT EXISTS idx_enf_recipients_user ON enf_recipients(counterparty_user_id);

-- Signature lookups
CREATE INDEX IF NOT EXISTS idx_enf_signatures_signer ON enf_signatures(signer_address);

-- Event lookups
CREATE INDEX IF NOT EXISTS idx_enf_events_bundle ON enf_events(enf_id);
CREATE INDEX IF NOT EXISTS idx_enf_events_recipient ON enf_events(recipient_id);
CREATE INDEX IF NOT EXISTS idx_enf_events_type ON enf_events(event_type);
CREATE INDEX IF NOT EXISTS idx_enf_events_created ON enf_events(created_at);
