/**
 * PDF Dossier Types and Schemas
 *
 * User-intent framing for dossier export options.
 */

import { z } from 'zod';

// ============================================================================
// User Intent Options (plain language)
// ============================================================================

/**
 * User-facing export types with plain language descriptions.
 */
export type DossierIntent =
    | 'evidence'           // "Evidence of what happened" → ENF bundle + signatures + audit trail
    | 'dispute'            // "Dispute documentation" → Above + Challenge + Dispute records
    | 'legal_package'      // "Complete legal package" → Full suite
    | 'custom';            // "Custom" → Granular selection

export const DossierIntentSchema = z.enum(['evidence', 'dispute', 'legal_package', 'custom']);

// ============================================================================
// Section Configuration
// ============================================================================

/**
 * Available sections in the dossier.
 */
export type DossierSection =
    | 'cover'              // Cover page with case summary
    | 'toc'                // Table of contents
    | 'evidence_overview'  // ENF bundle summary
    | 'recipients'         // Recipient status and acknowledgments
    | 'signatures'         // Cryptographic signatures
    | 'audit_trail'        // Complete audit trail
    | 'challenge'          // Challenge details (if applicable)
    | 'dispute'            // Dispute details (if applicable)
    | 'risk_assessment'    // LLM analysis and risk scores
    | 'blockchain_proof'   // Blockchain anchor details
    | 'verification'       // "How to verify" appendix (always included)
    | 'raw_data';          // Machine-readable appendix

export const DossierSectionSchema = z.enum([
    'cover',
    'toc',
    'evidence_overview',
    'recipients',
    'signatures',
    'audit_trail',
    'challenge',
    'dispute',
    'risk_assessment',
    'blockchain_proof',
    'verification',
    'raw_data',
]);

/**
 * Map from intent to included sections.
 */
export const INTENT_SECTIONS: Record<DossierIntent, DossierSection[]> = {
    evidence: [
        'cover',
        'toc',
        'evidence_overview',
        'recipients',
        'signatures',
        'audit_trail',
        'blockchain_proof',
        'verification',
    ],
    dispute: [
        'cover',
        'toc',
        'evidence_overview',
        'recipients',
        'signatures',
        'audit_trail',
        'challenge',
        'dispute',
        'blockchain_proof',
        'verification',
    ],
    legal_package: [
        'cover',
        'toc',
        'evidence_overview',
        'recipients',
        'signatures',
        'audit_trail',
        'challenge',
        'dispute',
        'risk_assessment',
        'blockchain_proof',
        'verification',
        'raw_data',
    ],
    custom: [], // User specifies
};

// ============================================================================
// Export Request Schema
// ============================================================================

export const DossierExportRequestSchema = z.object({
    /** Target entity type */
    target_type: z.enum(['ENF_BUNDLE', 'CHALLENGE']),
    /** Target entity ID */
    target_id: z.string().uuid(),
    /** User intent (determines sections) */
    intent: DossierIntentSchema,
    /** Custom sections (only if intent is 'custom') */
    sections: z.array(DossierSectionSchema).optional(),
    /** Include raw JSON data appendix */
    include_raw_data: z.boolean().optional().default(false),
});

export type DossierExportRequest = z.infer<typeof DossierExportRequestSchema>;

// ============================================================================
// Aggregated Data Types
// ============================================================================

/**
 * Blockchain anchor information.
 */
export interface BlockchainAnchor {
    chain: 'polygon' | 'ethereum' | 'base';
    chain_name: string;
    tx_hash: string;
    block_number?: number;
    timestamp?: number;
    merkle_root?: string;
    merkle_proof?: string[];
    explorer_url: string;
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
}

/**
 * Signature information for display.
 */
export interface SignatureRecord {
    recipient_id: string;
    recipient_identifier: string;
    signature_type: string;
    signature?: string;
    message_hash?: string;
    signer_address?: string;
    verified: boolean;
    verification_error?: string;
    signed_at: number;
}

/**
 * Audit event for display.
 */
export interface AuditEventRecord {
    timestamp: string;
    event_type: string;
    actor_type: string;
    actor: string | null;
    recipient_id: string | null;
    details: Record<string, unknown> | null;
}

/**
 * Risk assessment summary.
 */
export interface RiskAssessment {
    analysis_id?: string;
    risk_score?: number;
    risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendation?: 'PROCEED' | 'CAUTION' | 'BLOCK' | 'REVIEW';
    summary?: string;
    flags: Array<{
        flag_type: string;
        severity: string;
        title: string;
        description: string;
    }>;
    analyzed_at?: number;
}

/**
 * Complete aggregated dossier data.
 */
export interface DossierData {
    // Metadata
    export_id: string;
    exported_at: string;
    exported_by_user_id: string;
    intent: DossierIntent;
    sections: DossierSection[];

    // Document hashes for integrity
    document_hash?: string;
    content_hash: string;

    // ENF Bundle (always present)
    enf_bundle?: {
        id: string;
        title: string;
        description?: string;
        status: string;
        evidence_hash: string;
        evidence_payload?: Record<string, unknown>;
        initiator_user_id: string;
        initiator_wallet?: string;
        expires_at: number;
        created_at: number;
        updated_at: number;
    };

    // Recipients
    recipients?: Array<{
        id: string;
        type: string;
        identifier: string;
        status: string;
        sent_at?: number;
        delivered_at?: number;
        responded_at?: number;
        response_message?: string;
    }>;

    // Signatures
    signatures?: SignatureRecord[];

    // Audit trail
    audit_trail?: {
        events: AuditEventRecord[];
        hash: string;
    };

    // Challenge (if applicable)
    challenge?: {
        id: string;
        mode: string;
        title?: string;
        description?: string;
        status: string;
        creator_user_id: string;
        counterparty_user_id?: string;
        created_at: number;
        resolved_at?: number;
    };

    // Dispute (if applicable)
    dispute?: {
        id: string;
        challenge_id: string;
        raised_by_user_id: string;
        reason: string;
        evidence?: Record<string, unknown>;
        status: string;
        winner_user_id?: string;
        resolution?: string;
        resolved_at?: number;
        created_at: number;
    };

    // Risk assessment
    risk_assessment?: RiskAssessment;

    // Blockchain anchor
    blockchain_anchor?: BlockchainAnchor;

    // Verification info
    verification: {
        portal_url: string;
        qr_code_data: string;
        blockchain_explorer_url?: string;
        document_hash: string;
        hash_algorithm: 'SHA-256';
    };
}

// ============================================================================
// PDF Generation Config
// ============================================================================

export interface PdfConfig {
    /** Page size */
    pageSize: 'A4' | 'LETTER';
    /** Include page numbers */
    pageNumbers: boolean;
    /** Include TattleHash watermark */
    watermark: boolean;
    /** Font size base (points) */
    baseFontSize: number;
}

export const DEFAULT_PDF_CONFIG: PdfConfig = {
    pageSize: 'A4',
    pageNumbers: true,
    watermark: false,
    baseFontSize: 10,
};

// ============================================================================
// Response Types
// ============================================================================

export interface DossierExportResponse {
    /** Export ID for tracking */
    export_id: string;
    /** Target type */
    target_type: 'ENF_BUNDLE' | 'CHALLENGE';
    /** Target ID */
    target_id: string;
    /** Document hash for verification */
    document_hash: string;
    /** Export timestamp */
    exported_at: string;
    /** Verification portal URL */
    verification_url: string;
    /** Download URL (presigned or direct) */
    download_url?: string;
}
