// Database row types matching D1 schema (002_complete_schema.sql + 003_add_awaiting_gatekeeper.sql)

export interface User {
    id: string;
    wallet_address: string;
    created_at: number;
    updated_at: number;
}

/** @deprecated Use Challenge from src/gatekeeper/challenges/types.ts instead */
export type ChallengeStatus =
    | 'DRAFT'
    | 'AWAITING_COUNTERPARTY'
    | 'AWAITING_GATEKEEPER'
    | 'INTENT_LOCKED'
    | 'AWAITING_RESOLUTION'
    | 'DISPUTED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'EXPIRED';

/** @deprecated Use Challenge from src/gatekeeper/challenges/types.ts instead */
export type ChallengeMode = 'SOLO' | 'GATEKEEPER' | 'FIRE' | 'ENFORCED';

/**
 * Challenge row type matching D1 schema.
 * @deprecated Prefer using Challenge from src/gatekeeper/challenges/types.ts
 *             This type is kept for backwards compatibility with existing code.
 */
export interface Challenge {
    id: string;
    mode: ChallengeMode;
    creator_user_id: string;
    counterparty_user_id?: string;
    title?: string;
    description?: string;
    status: ChallengeStatus;
    created_at: number;
    updated_at: number;
    expires_at?: string;
    intent_locked_at?: number;
    resolved_at?: number;
}

export interface WalletChallenge {
    id: string;
    wallet_address: string;
    nonce: string;
    chain_id: string;
    created_at: number;
    expires_at: number;
    used_at?: number;
}

export interface Webhook {
    id: string;
    user_id: string;
    url: string;
    secret: string;
    events: string; // JSON array of event types
    created_at: number;
    active: number; // boolean 0/1
}

export interface WebhookDelivery {
    id: string;
    subscription_id: string;
    event_type: string;
    payload: string; // JSON
    status: 'PENDING' | 'DELIVERED' | 'FAILED';
    attempts: number;
    last_attempt_at?: number;
    delivered_at?: number;
    created_at: number;
}

export interface ChallengeDispute {
    id: string;
    challenge_id: string;
    raised_by_user_id: string;
    reason: string;
    evidence?: string; // JSON
    status: 'PENDING' | 'RESOLVED';
    winner_user_id?: string;
    resolution?: string;
    resolved_at?: number;
    created_at: number;
}

export interface FundsRequirement {
    id: string;
    challenge_id: string;
    user_id: string;
    wallet_address: string;
    network: string;
    asset_type: 'NATIVE' | 'ERC20';
    token_address?: string;
    min_balance: string;
    currency_symbol: string;
    snapshot_policy: 'AT_CREATION' | 'AT_INTENT_LOCK' | 'AT_COMPLETION';
}

export interface BondDeposit {
    id: string;
    challenge_id: string;
    user_id: string;
    amount: string;
    currency_code: string;
    tx_hash?: string;
    deposited_at: number;
    status: 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'FORFEITED';
}

// Enforced Mode Types
export type StakeStatus = 'PENDING' | 'CONFIRMED' | 'HELD' | 'RELEASED' | 'TRANSFERRED' | 'SLASHED';

export interface Stake {
    id: string;
    challenge_id: string;
    user_id: string;
    wallet_address: string;
    amount: string;
    currency_code: string;
    chain_id: string;
    token_address?: string;
    deposit_tx_hash?: string;
    release_tx_hash?: string;
    status: StakeStatus;
    deposited_at?: number;
    confirmed_at?: number;
    released_at?: number;
    created_at: number;
    updated_at: number;
}

export interface EnforcedThreshold {
    id: string;
    challenge_id: string;
    min_usd_value: string;
    max_usd_value?: string;
    required_confirmations: number;
    allowed_chains: string;
    allowed_assets: string;
    deal_expiry_at?: string;
    creator_stake_required: string;
    counterparty_stake_required: string;
    stake_currency: string;
    created_at: number;
}

export type TrafficLightState = 'GREEN' | 'YELLOW' | 'RED';

export interface TrafficLightRecord {
    id: string;
    challenge_id: string;
    state: TrafficLightState;
    reason: string;
    details?: string;
    evaluated_at: number;
}

export interface StakeEvent {
    id: string;
    stake_id: string;
    event_type: string;
    tx_hash?: string;
    details?: string;
    created_at: number;
}

// ============================================================================
// ENF (Evidence-and-Forward) Types
// ============================================================================

export type EnfBundleStatus =
    | 'DRAFT'
    | 'SENT'
    | 'PARTIAL'
    | 'COMPLETE'
    | 'EXPIRED'
    | 'CANCELLED';

export interface EnfBundle {
    id: string;
    initiator_user_id: string;
    initiator_wallet?: string;
    title: string;
    description?: string;
    evidence_hash: string;
    evidence_payload: string; // JSON
    status: EnfBundleStatus;
    expires_at: number;
    created_at: number;
    updated_at: number;
}

export type EnfRecipientType = 'EMAIL' | 'WALLET' | 'USER_ID';

export type EnfRecipientStatus =
    | 'PENDING'
    | 'SENT'
    | 'DELIVERED'
    | 'ACKNOWLEDGED'
    | 'DECLINED'
    | 'EXPIRED';

export interface EnfRecipient {
    id: string;
    enf_id: string;
    counterparty_type: EnfRecipientType;
    counterparty_identifier: string;
    counterparty_user_id?: string;
    delivery_token?: string;
    delivery_link?: string;
    status: EnfRecipientStatus;
    response_message?: string;
    sent_at?: number;
    delivered_at?: number;
    responded_at?: number;
    created_at: number;
    updated_at: number;
}

export type EnfSignatureType = 'EIP191' | 'EIP712' | 'CLICK_ACK' | 'EMAIL_REPLY';

export interface EnfSignature {
    id: string;
    recipient_id: string;
    signature_type: EnfSignatureType;
    signature?: string;
    message_hash?: string;
    signer_address?: string;
    verified: boolean;
    verification_error?: string;
    signed_at: number;
    verified_at?: number;
    created_at: number;
}

export type EnfEventType =
    | 'CREATED'
    | 'UPDATED'
    | 'SENT'
    | 'DELIVERED'
    | 'VIEWED'
    | 'ACKNOWLEDGED'
    | 'SIGNED'
    | 'DECLINED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'DISPUTED'
    | 'REMINDER_SENT';

export type EnfActorType = 'INITIATOR' | 'RECIPIENT' | 'SYSTEM';

export interface EnfEvent {
    id: string;
    enf_id: string;
    recipient_id?: string;
    event_type: EnfEventType;
    actor_type: EnfActorType;
    actor_identifier?: string;
    details?: string; // JSON
    ip_address?: string;
    user_agent?: string;
    created_at: number;
}

// ============================================================================
// LLM Monitoring Types
// ============================================================================

export type LlmTargetType = 'CHALLENGE' | 'DISPUTE' | 'ENF_BUNDLE' | 'USER' | 'TRANSACTION';

export type LlmMonitoringMode = 'EXPLORATORY' | 'BALANCED' | 'PRECISION';

export type LlmTriggerType = 'AUTO' | 'MANUAL' | 'THRESHOLD' | 'SCHEDULED';

export type LlmAnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export type LlmRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type LlmRecommendation = 'PROCEED' | 'CAUTION' | 'BLOCK' | 'REVIEW';

export interface LlmAnalysis {
    id: string;
    target_type: LlmTargetType;
    target_id: string;
    monitoring_mode: LlmMonitoringMode;
    trigger_type: LlmTriggerType;
    requested_by_user_id?: string;
    status: LlmAnalysisStatus;
    risk_score?: number; // 0-100
    risk_level?: LlmRiskLevel;
    recommendation?: LlmRecommendation;
    summary?: string;
    model_used?: string;
    total_tokens_used: number;
    processing_time_ms?: number;
    created_at: number;
    started_at?: number;
    completed_at?: number;
    expires_at?: number;
}

export type LlmAgentType = 'TRANSACTION_MONITOR' | 'FRAUD_ANALYZER' | 'COMPLIANCE_AUDITOR' | 'CUSTOM';

export type LlmAgentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface LlmAgentResult {
    id: string;
    analysis_id: string;
    agent_type: LlmAgentType;
    agent_name: string;
    agent_version: string;
    status: LlmAgentStatus;
    confidence_score?: number; // 0.0-1.0
    raw_output?: string; // JSON
    structured_output?: string; // JSON
    flags_raised: number;
    tokens_used: number;
    latency_ms?: number;
    started_at?: number;
    completed_at?: number;
}

export type LlmFlagType =
    | 'SCAM_PATTERN'
    | 'SUSPICIOUS_URL'
    | 'AMOUNT_ANOMALY'
    | 'TIMING_ANOMALY'
    | 'IDENTITY_MISMATCH'
    | 'BEHAVIOR_PATTERN'
    | 'COMPLIANCE_ISSUE'
    | 'VELOCITY_SPIKE'
    | 'COUNTERPARTY_RISK'
    | 'NETWORK_RISK'
    | 'CUSTOM';

export type LlmFlagSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LlmFlag {
    id: string;
    analysis_id: string;
    agent_result_id?: string;
    flag_type: LlmFlagType;
    severity: LlmFlagSeverity;
    title: string;
    description: string;
    evidence?: string; // JSON
    resolved: boolean;
    resolved_by_user_id?: string;
    resolution_notes?: string;
    resolved_at?: number;
    created_at: number;
}

export interface LlmRiskScore {
    id: string;
    entity_type: 'USER' | 'WALLET' | 'CHALLENGE' | 'TRANSACTION';
    entity_id: string;
    score: number; // 0-100
    risk_level: LlmRiskLevel;
    score_breakdown?: string; // JSON
    analysis_id?: string;
    scoring_version: string;
    calculated_at: number;
    valid_until?: number;
}

export type LlmUrlScanStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS' | 'ERROR';

export type LlmThreatType = 'PHISHING' | 'MALWARE' | 'SCAM' | 'SPAM' | 'IMPERSONATION' | 'UNKNOWN';

export interface LlmUrlScan {
    id: string;
    url: string;
    domain: string;
    normalized_url: string;
    source_analysis_id?: string;
    found_in_target_type?: string;
    found_in_target_id?: string;
    status: LlmUrlScanStatus;
    threat_type?: LlmThreatType;
    threat_score?: number; // 0-100
    scan_sources?: string; // JSON
    raw_results?: string; // JSON
    first_seen_at: number;
    last_scanned_at?: number;
    scan_count: number;
}

export interface LlmAgentConfig {
    id: string;
    agent_type: LlmAgentType;
    agent_name: string;
    version: string;
    system_prompt: string;
    temperature: number;
    max_tokens: number;
    enabled: boolean;
    monitoring_modes: string; // JSON array
    description?: string;
    created_by_user_id?: string;
    created_at: number;
    updated_at: number;
}

export interface LlmMonitoringConfig {
    mode: LlmMonitoringMode;
    description: string;
    risk_threshold_low: number;
    risk_threshold_medium: number;
    risk_threshold_high: number;
    required_agents: string; // JSON array
    optional_agents?: string; // JSON array
    auto_block_threshold?: number;
    require_human_review_threshold?: number;
    analysis_timeout_ms: number;
    updated_at: number;
}

// ============================================================================
// Credits & Loyalty Types
// ============================================================================

export type LoyaltyTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface LoyaltyTierConfig {
    tier: LoyaltyTier;
    display_name: string;
    min_transactions: number;
    credit_back_percent: number;
    credit_expiry_days: number;
    perks?: string; // JSON array
    created_at: number;
    updated_at: number;
}

export type CreditType = 'REFERRAL_REWARD' | 'PROMO' | 'MILESTONE' | 'LOYALTY';

export type CreditSourceType = 'REFERRAL' | 'PROMO_CODE' | 'MILESTONE' | 'LOYALTY_CASHBACK' | 'ADMIN';

export type CreditBalanceStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';

export interface UserCredits {
    user_id: string;
    total_available: number;
    total_pending: number;
    loyalty_tier: LoyaltyTier;
    lifetime_transactions: number;
    lifetime_credits_earned: number;
    lifetime_credits_used: number;
    referral_code?: string;
    referred_by_user_id?: string;
    referral_coupons_available: number;
    referral_coupons_sent: number;
    referral_conversions: number;
    created_at: number;
    updated_at: number;
}

export interface CreditBalance {
    id: string;
    user_id: string;
    credit_type: CreditType;
    amount: number;
    remaining: number;
    source_type: CreditSourceType;
    source_id?: string;
    source_description?: string;
    expires_at: number;
    status: CreditBalanceStatus;
    granted_at: number;
    exhausted_at?: number;
}

export type CreditEventType = 'GRANT' | 'REDEEM' | 'EXPIRE' | 'CANCEL' | 'REFUND' | 'HOLD' | 'RELEASE';

export interface CreditEvent {
    id: string;
    user_id: string;
    event_type: CreditEventType;
    credit_type?: CreditType;
    amount: number;
    balance_before: number;
    balance_after: number;
    credit_balance_id?: string;
    transaction_id?: string;
    promotion_id?: string;
    referral_id?: string;
    description: string;
    metadata?: string; // JSON
    created_at: number;
}

export type PromotionStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';

export interface Promotion {
    id: string;
    code: string;
    name: string;
    description?: string;
    credits_granted: number;
    credit_type: CreditType;
    expiry_days: number;
    max_claims?: number;
    claims_count: number;
    max_claims_per_user: number;
    new_users_only: boolean;
    min_tier?: LoyaltyTier;
    starts_at: number;
    ends_at?: number;
    status: PromotionStatus;
    created_at: number;
    created_by_user_id?: string;
    updated_at: number;
}

export interface PromotionClaim {
    id: string;
    promotion_id: string;
    user_id: string;
    credits_granted: number;
    credit_balance_id: string;
    claimed_at: number;
}

export type ReferralCouponStatus = 'PENDING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';

export interface ReferralCoupon {
    id: string;
    sender_user_id: string;
    coupon_code: string;
    recipient_email?: string;
    status: ReferralCouponStatus;
    claimed_by_user_id?: string;
    claimed_at?: number;
    converted: boolean;
    converted_at?: number;
    reward_granted: boolean;
    reward_granted_at?: number;
    expires_at: number;
    created_at: number;
}

export interface CreditMilestone {
    id: string;
    name: string;
    description?: string;
    transaction_count: number;
    credits_awarded: number;
    active: boolean;
    created_at: number;
}

export interface UserMilestone {
    id: string;
    user_id: string;
    milestone_id: string;
    achieved_at: number;
    credits_awarded: number;
    credit_balance_id: string;
}

export type CreditHoldStatus = 'HELD' | 'RELEASED' | 'APPLIED' | 'EXPIRED';

export interface CreditHold {
    id: string;
    user_id: string;
    amount: number;
    reason: string;
    transaction_id?: string;
    challenge_id?: string;
    status: CreditHoldStatus;
    resolved_at?: number;
    resolution_type?: string;
    created_at: number;
    expires_at: number;
}
