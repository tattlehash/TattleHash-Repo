/**
 * Gatekeeper Mutual Verification Types
 *
 * Mutual verification with privacy-respecting asymmetry.
 * Users must verify themselves before using Gatekeeper.
 * Badge earned based on external signals (not TattleHash tenure).
 */

// ============================================================================
// Database Row Types
// ============================================================================

export interface CheckTypeRow {
    id: string;
    category: string;
    name: string;
    description: string | null;
    method: string;
    oauth_provider: string | null;
    badge_required: number;
    badge_threshold: string | null;
    enabled: number;
    sort_order: number;
    created_at: number;
}

export interface ProfileRow {
    id: string;
    name: string;
    description: string | null;
    target_market: string | null;
    enabled: number;
    sort_order: number;
    created_at: number;
}

export interface ProfileCheckRow {
    profile_id: string;
    check_type_id: string;
    required: number;
    sort_order: number;
}

export interface UserVerificationRow {
    id: string;
    user_id: string;
    profile_id: string;
    status: string;
    signal_summary: string | null;
    badge_granted: number;
    badge_reason: string | null;
    wallet_address: string | null;
    wallet_chain: string | null;
    created_at: number;
    verified_at: number | null;
    expires_at: number | null;
}

export interface UserVerificationCheckRow {
    id: string;
    user_verification_id: string;
    check_type_id: string;
    status: string;
    signal_type: string | null;
    signal_text: string | null;
    meets_badge_threshold: number | null;
    raw_data: string | null;
    created_at: number;
    checked_at: number | null;
}

export interface SessionRow {
    id: string;
    profile_id: string;
    status: string;
    initiator_user_id: string;
    initiator_verification_id: string;
    initiator_badge_status: number;
    counterparty_email: string;
    counterparty_user_id: string | null;
    counterparty_verification_status: string;
    counterparty_signal_summary: string | null;
    counterparty_wallet_address: string | null;
    title: string | null;
    description: string | null;
    required_chain: string;
    required_token: string;
    required_balance: string | null;
    required_balance_display: string | null;
    content_hash: string | null;
    file_name: string | null;
    file_size: number | null;
    file_type: string | null;
    verification_code: string | null;
    verification_code_expires_at: number | null;
    verification_attempts: number;
    attestation_id: string | null;
    created_at: number;
    expires_at: number | null;
    completed_at: number | null;
    aborted_at: number | null;
    abort_reason: string | null;
}

export interface SessionCheckRow {
    id: string;
    session_id: string;
    check_type_id: string;
    status: string;
    signal_type: string | null;
    signal_text: string | null;
    raw_data: string | null;
    created_at: number;
    checked_at: number | null;
}

export interface EventRow {
    id: string;
    session_id: string | null;
    user_verification_id: string | null;
    event_type: string;
    actor_type: string | null;
    actor_identifier: string | null;
    details: string | null;
    created_at: number;
}

// ============================================================================
// Status Types
// ============================================================================

export type VerificationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type CheckStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type SignalSummary = 'CLEAR' | 'CAUTION' | 'REVIEW_RECOMMENDED';
export type SignalType = 'positive' | 'neutral' | 'warning';

export type SessionStatus =
    | 'PENDING'
    | 'COUNTERPARTY_INVITED'
    | 'COUNTERPARTY_VERIFYING'
    | 'VERIFIED'
    | 'COMPLETED'
    | 'ABORTED'
    | 'EXPIRED';

export type EventType =
    | 'USER_VERIFICATION_STARTED'
    | 'USER_VERIFICATION_COMPLETED'
    | 'SESSION_CREATED'
    | 'COUNTERPARTY_INVITED'
    | 'COUNTERPARTY_VERIFIED'
    | 'CHECK_COMPLETED'
    | 'SESSION_COMPLETED'
    | 'SESSION_ABORTED';

// ============================================================================
// API Input Types
// ============================================================================

export interface StartVerificationInput {
    profile_id: string;
    wallet_address?: string;
    wallet_chain?: string;
}

export interface SubmitWalletSignatureInput {
    wallet_address: string;
    signature: string;
    message: string;
    chain?: string;
}

export interface CreateSessionInput {
    profile_id: string;
    counterparty_email: string;
    title?: string;
    description?: string;
    required_chain?: string;
    required_token?: string;
    required_balance?: string;
    required_balance_display?: string;
    content_hash?: string;
    file_name?: string;
    file_size?: number;
    file_type?: string;
}

export interface VerifyCounterpartyCodeInput {
    code: string;
}

export interface VerifyCounterpartyWalletInput {
    wallet_address: string;
    signature: string;
    message: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface CheckType {
    id: string;
    category: string;
    name: string;
    description: string | null;
    method: string;
    badge_required: boolean;
}

export interface Profile {
    id: string;
    name: string;
    description: string | null;
    target_market: string | null;
    checks: CheckType[];
}

export interface CheckResult {
    check_type_id: string;
    check_name: string;
    status: CheckStatus;
    signal_type: SignalType | null;
    signal_text: string | null;
    meets_badge_threshold: boolean | null;
}

export interface UserVerification {
    id: string;
    profile_id: string;
    profile_name: string;
    status: VerificationStatus;
    signal_summary: SignalSummary | null;
    badge_granted: boolean;
    badge_reason: string | null;
    wallet_address: string | null;
    checks: CheckResult[];
    created_at: string;
    verified_at: string | null;
    expires_at: string | null;
}

export interface SessionSummary {
    id: string;
    title: string | null;
    status: SessionStatus;
    profile_name: string;
    counterparty_email: string;
    initiator_badge_status: boolean;
    created_at: string;
    expires_at: string | null;
}

export interface SessionDetail {
    id: string;
    title: string | null;
    description: string | null;
    status: SessionStatus;
    profile_id: string;
    profile_name: string;

    // Initiator
    initiator_user_id: string;
    initiator_email: string;
    initiator_badge_status: boolean;

    // Counterparty
    counterparty_email: string;
    counterparty_verification_status: string;
    counterparty_signal_summary: SignalSummary | null;
    counterparty_wallet_address: string | null;

    // Requirements
    required_chain: string;
    required_token: string;
    required_balance: string | null;
    required_balance_display: string | null;

    // Document
    content_hash: string | null;
    file_name: string | null;
    file_size: number | null;
    file_type: string | null;

    // Check results (for initiator viewing counterparty results)
    checks: CheckResult[];

    // Attestation
    attestation_id: string | null;

    // Timing
    created_at: string;
    expires_at: string | null;
    completed_at: string | null;

    // Test mode only - remove in production
    _test_verification_code?: string;
}

export interface CounterpartyViewSession {
    id: string;
    title: string | null;
    initiator_email: string;
    initiator_badge_status: boolean;
    required_chain: string;
    required_token: string;
    required_balance: string | null;
    required_balance_display: string | null;
    checks_required: CheckType[];
}

// ============================================================================
// Badge Threshold Types
// ============================================================================

export interface WalletAgeThreshold {
    min_days: number;
}

export interface TxCountThreshold {
    min_count: number;
}

export interface ChainabuseThreshold {
    max_reports: number;
}
