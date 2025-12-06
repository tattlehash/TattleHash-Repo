-- Migration: 015_enforced_sessions
-- Enforced Mode: Multi-party document review with server-side storage
--
-- Enforced mode allows 2+ parties to upload, review, and agree on documents.
-- Files stored temporarily in R2, deleted immediately on completion/void.
-- Architecture supports N-party but Phase 1 implements 2-party flow.

-- ============================================================================
-- Enforced Sessions (designed for N-party expansion)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enforced_sessions (
    id TEXT PRIMARY KEY,
    initiator_user_id TEXT NOT NULL,

    -- Session details
    title TEXT,
    description TEXT,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING',      -- Waiting for counterparty verification
        'REVIEW',       -- All parties verified, reviewing documents
        'PARKED',       -- Session paused (timer stopped)
        'AGREED',       -- All parties agreed, attestation created
        'VOID',         -- Declined or cancelled
        'EXPIRED'       -- Review period timeout
    )),

    -- Governance settings (for future N-party expansion)
    temperature TEXT DEFAULT 'BALANCED' CHECK (temperature IN (
        'STRICT',       -- Formal governance, Robert's Rules
        'FORMAL',       -- Structured but flexible
        'BALANCED',     -- Default: reasonable flexibility
        'FLUID'         -- Minimal structure
    )),

    -- Timing
    review_period_hours INTEGER DEFAULT 72,
    min_participants INTEGER DEFAULT 2,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    completed_at INTEGER,

    -- Park feature
    parked_at INTEGER,
    parked_until INTEGER,
    parked_by_participant_id TEXT,
    park_reason TEXT,
    total_parked_hours INTEGER DEFAULT 0,
    park_count INTEGER DEFAULT 0,

    -- Completion
    attestation_id TEXT,        -- Links to challenge/receipt on completion
    anchor_tx_hash TEXT,        -- Blockchain transaction hash
    merkle_root TEXT,           -- Combined hash of all documents

    -- Credits (held until completion)
    credits_held INTEGER DEFAULT 12,
    credits_consumed_at INTEGER,

    FOREIGN KEY (initiator_user_id) REFERENCES users(id)
);

-- ============================================================================
-- Enforced Participants (N-party ready)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enforced_participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,

    -- Identification
    email TEXT NOT NULL,
    user_id TEXT,               -- NULL until they create account/login

    -- Role (for future expansion)
    role TEXT DEFAULT 'PARTICIPANT' CHECK (role IN (
        'INITIATOR',            -- Created the session
        'PARTICIPANT',          -- Full document access + agreement rights
        'OBSERVER'              -- View-only (future feature)
    )),

    -- Email verification
    verification_code TEXT,
    verification_expires_at INTEGER,
    verified_at INTEGER,

    -- Agreement status
    agreement_status TEXT DEFAULT 'PENDING' CHECK (agreement_status IN (
        'PENDING',              -- Not yet agreed
        'AGREED',               -- Clicked agree
        'DECLINED'              -- Explicitly declined
    )),
    agreed_at INTEGER,
    declined_at INTEGER,
    decline_reason TEXT,

    -- Park consent
    park_consent_status TEXT CHECK (park_consent_status IN (
        'PENDING',
        'ACCEPTED',
        'DECLINED'
    )),
    park_consent_at INTEGER,

    -- Timing
    created_at INTEGER NOT NULL,
    joined_at INTEGER,          -- When they completed verification + account

    FOREIGN KEY (session_id) REFERENCES enforced_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================================
-- Enforced Documents (per-participant uploads stored in R2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enforced_documents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,

    -- R2 storage
    r2_key TEXT NOT NULL,       -- Path in R2 bucket: /sessions/{session_id}/{participant_id}/{uuid}_{filename}

    -- File metadata
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    content_hash TEXT NOT NULL, -- SHA-256 computed during upload

    -- Timing
    uploaded_at INTEGER NOT NULL,
    deleted_at INTEGER,         -- Set when file cleaned up from R2

    FOREIGN KEY (session_id) REFERENCES enforced_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES enforced_participants(id) ON DELETE CASCADE
);

-- ============================================================================
-- Enforced Events (audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS enforced_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    participant_id TEXT,        -- NULL for session-level events

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN (
        'SESSION_CREATED',
        'INVITE_SENT',
        'PARTICIPANT_VERIFIED',
        'PARTICIPANT_JOINED',
        'DOCUMENT_UPLOADED',
        'DOCUMENT_DELETED',
        'DOCUMENT_VIEWED',
        'AGREEMENT_SUBMITTED',
        'AGREEMENT_RESET',      -- When new document uploaded
        'DECLINE_SUBMITTED',
        'PARK_REQUESTED',
        'PARK_ACCEPTED',
        'PARK_DECLINED',
        'SESSION_RESUMED',
        'SESSION_COMPLETED',
        'SESSION_VOIDED',
        'SESSION_EXPIRED',
        'CLEANUP_COMPLETED'
    )),

    -- Actor information
    actor_type TEXT NOT NULL CHECK (actor_type IN (
        'INITIATOR',
        'PARTICIPANT',
        'SYSTEM'
    )),
    actor_identifier TEXT,      -- user_id or 'system'

    -- Event context
    details TEXT,               -- JSON with additional context
    ip_address TEXT,
    user_agent TEXT,

    -- Timing (immutable)
    created_at INTEGER NOT NULL,

    FOREIGN KEY (session_id) REFERENCES enforced_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES enforced_participants(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Session lookups
CREATE INDEX IF NOT EXISTS idx_enforced_sessions_initiator ON enforced_sessions(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_enforced_sessions_status ON enforced_sessions(status);
CREATE INDEX IF NOT EXISTS idx_enforced_sessions_expires ON enforced_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_enforced_sessions_created ON enforced_sessions(created_at);

-- Participant lookups
CREATE INDEX IF NOT EXISTS idx_enforced_participants_session ON enforced_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_enforced_participants_email ON enforced_participants(email);
CREATE INDEX IF NOT EXISTS idx_enforced_participants_user ON enforced_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_enforced_participants_verification ON enforced_participants(verification_code);

-- Document lookups
CREATE INDEX IF NOT EXISTS idx_enforced_documents_session ON enforced_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_enforced_documents_participant ON enforced_documents(participant_id);
CREATE INDEX IF NOT EXISTS idx_enforced_documents_deleted ON enforced_documents(deleted_at);

-- Event lookups
CREATE INDEX IF NOT EXISTS idx_enforced_events_session ON enforced_events(session_id);
CREATE INDEX IF NOT EXISTS idx_enforced_events_participant ON enforced_events(participant_id);
CREATE INDEX IF NOT EXISTS idx_enforced_events_type ON enforced_events(event_type);
CREATE INDEX IF NOT EXISTS idx_enforced_events_created ON enforced_events(created_at);
