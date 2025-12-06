/**
 * Enforced Mode Type Definitions
 *
 * Multi-party document review with server-side R2 storage.
 * Phase 1: 2-party flow. Architecture supports N-party expansion.
 */

// ============================================================================
// Enums and Constants
// ============================================================================

export type SessionStatus =
    | 'PENDING'     // Waiting for counterparty verification
    | 'REVIEW'      // All parties verified, reviewing documents
    | 'PARKED'      // Session paused (timer stopped)
    | 'AGREED'      // All parties agreed, attestation created
    | 'VOID'        // Declined or cancelled
    | 'EXPIRED';    // Review period timeout

export type Temperature =
    | 'STRICT'      // Formal governance
    | 'FORMAL'      // Structured but flexible
    | 'BALANCED'    // Default
    | 'FLUID';      // Minimal structure

export type ParticipantRole =
    | 'INITIATOR'   // Created the session
    | 'PARTICIPANT' // Full access + agreement rights
    | 'OBSERVER';   // View-only (future)

export type AgreementStatus =
    | 'PENDING'     // Not yet agreed
    | 'AGREED'      // Clicked agree
    | 'DECLINED';   // Explicitly declined

export type ParkConsentStatus =
    | 'PENDING'
    | 'ACCEPTED'
    | 'DECLINED';

export type EventType =
    | 'SESSION_CREATED'
    | 'INVITE_SENT'
    | 'PARTICIPANT_VERIFIED'
    | 'PARTICIPANT_JOINED'
    | 'DOCUMENT_UPLOADED'
    | 'DOCUMENT_DELETED'
    | 'DOCUMENT_VIEWED'
    | 'AGREEMENT_SUBMITTED'
    | 'AGREEMENT_RESET'
    | 'DECLINE_SUBMITTED'
    | 'PARK_REQUESTED'
    | 'PARK_ACCEPTED'
    | 'PARK_DECLINED'
    | 'SESSION_RESUMED'
    | 'SESSION_COMPLETED'
    | 'SESSION_VOIDED'
    | 'SESSION_EXPIRED'
    | 'CLEANUP_COMPLETED';

export type ActorType = 'INITIATOR' | 'PARTICIPANT' | 'SYSTEM';

// Park duration options (in hours)
export const PARK_DURATIONS = {
    '24h': 24,
    '72h': 72,
    '7d': 168,
    '14d': 336,
    '30d': 720,
} as const;

export type ParkDuration = keyof typeof PARK_DURATIONS;

// Limits
export const ENFORCED_LIMITS = {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    MAX_FILES_PER_PARTICIPANT: 10,
    MAX_PARK_COUNT: 3,
    MAX_TOTAL_PARKED_HOURS: 90 * 24, // 90 days in hours
    DEFAULT_REVIEW_HOURS: 72,
    VERIFICATION_CODE_EXPIRY_HOURS: 24,
    SIGNED_URL_EXPIRY_SECONDS: 15 * 60, // 15 minutes
    CREDITS_REQUIRED: 12,
} as const;

// ============================================================================
// Database Row Types
// ============================================================================

export interface EnforcedSessionRow {
    id: string;
    initiator_user_id: string;
    title: string | null;
    description: string | null;
    status: SessionStatus;
    temperature: Temperature;
    review_period_hours: number;
    min_participants: number;
    created_at: number;
    expires_at: number | null;
    completed_at: number | null;
    parked_at: number | null;
    parked_until: number | null;
    parked_by_participant_id: string | null;
    park_reason: string | null;
    total_parked_hours: number;
    park_count: number;
    attestation_id: string | null;
    anchor_tx_hash: string | null;
    merkle_root: string | null;
    credits_held: number;
    credits_consumed_at: number | null;
}

export interface EnforcedParticipantRow {
    id: string;
    session_id: string;
    email: string;
    user_id: string | null;
    role: ParticipantRole;
    verification_code: string | null;
    verification_expires_at: number | null;
    verified_at: number | null;
    agreement_status: AgreementStatus;
    agreed_at: number | null;
    declined_at: number | null;
    decline_reason: string | null;
    park_consent_status: ParkConsentStatus | null;
    park_consent_at: number | null;
    created_at: number;
    joined_at: number | null;
}

export interface EnforcedDocumentRow {
    id: string;
    session_id: string;
    participant_id: string;
    r2_key: string;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    content_hash: string;
    uploaded_at: number;
    deleted_at: number | null;
}

export interface EnforcedEventRow {
    id: string;
    session_id: string;
    participant_id: string | null;
    event_type: EventType;
    actor_type: ActorType;
    actor_identifier: string | null;
    details: string | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: number;
}

// ============================================================================
// API Input Types
// ============================================================================

export interface CreateSessionInput {
    title?: string;
    description?: string;
    counterparty_email: string;
    review_period_hours?: number;
    temperature?: Temperature;
}

export interface VerifyParticipantInput {
    code: string;
}

export interface UploadDocumentInput {
    file: ReadableStream;
    file_name: string;
    file_size: number;
    mime_type?: string;
}

export interface RequestParkInput {
    duration: ParkDuration;
    reason?: string;
}

export interface DeclineInput {
    reason?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface SessionResponse {
    id: string;
    title: string | null;
    description: string | null;
    status: SessionStatus;
    initiator: {
        email: string;
        agreed: boolean;
    };
    counterparty: {
        email: string;
        verified: boolean;
        agreed: boolean;
    } | null;
    documents: DocumentResponse[];
    review_period_hours: number;
    created_at: string;
    expires_at: string | null;
    parked?: {
        at: string;
        until: string;
        reason: string | null;
        by: string;
    };
    attestation?: {
        id: string;
        tx_hash: string | null;
    };
}

export interface DocumentResponse {
    id: string;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    content_hash: string;
    uploaded_at: string;
    uploaded_by: string; // participant email
    is_own: boolean;     // whether current user uploaded this
}

export interface VerificationResponse {
    verified: boolean;
    session_id: string;
    requires_account: boolean;
}

export interface SignedUrlResponse {
    url: string;
    expires_at: string;
}

export interface ParkRequestResponse {
    pending_consent: boolean;
    parked: boolean;
    parked_until?: string;
}

export interface SessionStatusResponse {
    status: SessionStatus;
    all_agreed: boolean;
    participants: Array<{
        email: string;
        role: ParticipantRole;
        verified: boolean;
        agreed: boolean;
    }>;
    documents_count: number;
    expires_at: string | null;
    parked?: {
        at: string;
        until: string;
        pending_consent?: boolean;
    };
}

// ============================================================================
// Internal Types
// ============================================================================

export interface SessionWithParticipants extends EnforcedSessionRow {
    participants: EnforcedParticipantRow[];
}

export interface R2UploadResult {
    r2_key: string;
    content_hash: string;
}

export interface CompletionResult {
    attestation_id: string;
    merkle_root: string;
    anchor_tx_hash: string | null;
}
