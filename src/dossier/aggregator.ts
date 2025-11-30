/**
 * Dossier Data Aggregator
 *
 * Collects and assembles data from multiple sources for PDF generation.
 */

import { query, queryOne } from '../db';
import type { Env } from '../types';
import type {
    EnfBundle,
    EnfRecipient,
    EnfSignature,
    Challenge,
    ChallengeDispute,
    LlmAnalysis,
    LlmFlag,
    LlmRiskScore,
} from '../db/types';
import { exportBundleAuditTrail } from '../enf/events';
import { getReceipt } from '../anchor/storage';
import { queryTransactionStatus } from '../anchor/service';
import type {
    DossierData,
    DossierIntent,
    DossierSection,
    SignatureRecord,
    RiskAssessment,
    BlockchainAnchor,
    INTENT_SECTIONS,
} from './types';
import { generateVerificationUrl } from './qr-code';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAIN_CONFIG = {
    polygon: {
        name: 'Polygon',
        explorer: 'https://polygonscan.com/tx/',
    },
    ethereum: {
        name: 'Ethereum',
        explorer: 'https://etherscan.io/tx/',
    },
    base: {
        name: 'Base',
        explorer: 'https://basescan.org/tx/',
    },
} as const;

// ============================================================================
// Data Fetching Functions
// ============================================================================

/**
 * Fetch ENF bundle with recipients.
 */
async function fetchEnfBundle(
    env: Env,
    bundleId: string
): Promise<{ bundle: EnfBundle | null; recipients: EnfRecipient[] }> {
    const bundle = await queryOne<EnfBundle>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_bundles WHERE id = ?',
        [bundleId]
    );

    if (!bundle) {
        return { bundle: null, recipients: [] };
    }

    const recipients = await query<EnfRecipient>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_recipients WHERE enf_id = ? ORDER BY created_at ASC',
        [bundleId]
    );

    return { bundle, recipients };
}

/**
 * Fetch signatures for recipients.
 */
async function fetchSignatures(
    env: Env,
    recipientIds: string[]
): Promise<EnfSignature[]> {
    if (recipientIds.length === 0) return [];

    const placeholders = recipientIds.map(() => '?').join(', ');
    return query<EnfSignature>(
        env.TATTLEHASH_DB,
        `SELECT * FROM enf_signatures WHERE recipient_id IN (${placeholders}) ORDER BY signed_at ASC`,
        recipientIds
    );
}

/**
 * Fetch challenge by ID.
 */
async function fetchChallenge(
    env: Env,
    challengeId: string
): Promise<Challenge | null> {
    return queryOne<Challenge>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges WHERE id = ?',
        [challengeId]
    );
}

/**
 * Fetch dispute for a challenge.
 */
async function fetchDispute(
    env: Env,
    challengeId: string
): Promise<ChallengeDispute | null> {
    return queryOne<ChallengeDispute>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenge_disputes WHERE challenge_id = ? ORDER BY created_at DESC LIMIT 1',
        [challengeId]
    );
}

/**
 * Fetch LLM analysis for target.
 */
async function fetchLlmAnalysis(
    env: Env,
    targetType: string,
    targetId: string
): Promise<{ analysis: LlmAnalysis | null; flags: LlmFlag[] }> {
    const analysis = await queryOne<LlmAnalysis>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_analyses
         WHERE target_type = ? AND target_id = ? AND status = 'COMPLETED'
         ORDER BY completed_at DESC LIMIT 1`,
        [targetType, targetId]
    );

    if (!analysis) {
        return { analysis: null, flags: [] };
    }

    const flags = await query<LlmFlag>(
        env.TATTLEHASH_DB,
        'SELECT * FROM llm_flags WHERE analysis_id = ? ORDER BY severity DESC, created_at ASC',
        [analysis.id]
    );

    return { analysis, flags };
}

/**
 * Fetch risk score for entity.
 */
async function fetchRiskScore(
    env: Env,
    entityType: string,
    entityId: string
): Promise<LlmRiskScore | null> {
    return queryOne<LlmRiskScore>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_risk_scores
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY calculated_at DESC LIMIT 1`,
        [entityType, entityId]
    );
}

/**
 * Fetch blockchain anchor information.
 */
async function fetchBlockchainAnchor(
    env: Env,
    evidenceHash: string
): Promise<BlockchainAnchor | null> {
    // Try to find attestation record by evidence hash
    // The evidence hash would be used as initiatorCommit
    const receipt = await getReceipt(env, evidenceHash);

    if (!receipt || !receipt.txHash) {
        return null;
    }

    // Parse the final field for Merkle data
    let merkleRoot: string | undefined;
    let merkleProof: string[] | undefined;
    if (receipt.final) {
        try {
            const finalData = JSON.parse(receipt.final);
            merkleRoot = finalData.merkleRoot;
            merkleProof = finalData.proof;
        } catch {
            // Ignore parse errors
        }
    }

    // Determine chain from tx hash prefix or default to polygon
    const chain: 'polygon' | 'ethereum' | 'base' = 'polygon';
    const chainConfig = CHAIN_CONFIG[chain];

    // Query transaction status
    const txStatus = await queryTransactionStatus(env, receipt.txHash, chain);

    return {
        chain,
        chain_name: chainConfig.name,
        tx_hash: receipt.txHash,
        block_number: undefined, // Would need to query chain for this
        timestamp: receipt.receivedAt,
        merkle_root: merkleRoot,
        merkle_proof: merkleProof,
        explorer_url: `${chainConfig.explorer}${receipt.txHash}`,
        status: txStatus.confirmed ? 'confirmed' : txStatus.failed ? 'failed' : 'pending',
        confirmations: txStatus.confirmations,
    };
}

// ============================================================================
// Hash Computation
// ============================================================================

/**
 * Compute SHA-256 hash of content.
 */
async function computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Main Aggregation Function
// ============================================================================

/**
 * Aggregate all data for dossier generation.
 */
export async function aggregateDossierData(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string,
    intent: DossierIntent,
    sections: DossierSection[],
    userId: string
): Promise<DossierData> {
    const exportId = crypto.randomUUID();
    const exportedAt = new Date().toISOString();

    // Base verification URL
    const verificationBaseUrl = env.VERIFICATION_PORTAL_URL || 'https://verify.tattlehash.com';

    // Initialize data structure
    const data: DossierData = {
        export_id: exportId,
        exported_at: exportedAt,
        exported_by_user_id: userId,
        intent,
        sections,
        content_hash: '', // Will be computed at end
        verification: {
            portal_url: verificationBaseUrl,
            qr_code_data: '',
            document_hash: '',
            hash_algorithm: 'SHA-256',
        },
    };

    // Fetch ENF bundle data
    if (targetType === 'ENF_BUNDLE') {
        const { bundle, recipients } = await fetchEnfBundle(env, targetId);

        if (bundle) {
            data.enf_bundle = {
                id: bundle.id,
                title: bundle.title,
                description: bundle.description,
                status: bundle.status,
                evidence_hash: bundle.evidence_hash,
                evidence_payload: sections.includes('raw_data')
                    ? JSON.parse(bundle.evidence_payload)
                    : undefined,
                initiator_user_id: bundle.initiator_user_id,
                initiator_wallet: bundle.initiator_wallet,
                expires_at: bundle.expires_at,
                created_at: bundle.created_at,
                updated_at: bundle.updated_at,
            };

            // Recipients
            if (sections.includes('recipients') || sections.includes('evidence_overview')) {
                data.recipients = recipients.map(r => ({
                    id: r.id,
                    type: r.counterparty_type,
                    identifier: r.counterparty_identifier,
                    status: r.status,
                    sent_at: r.sent_at,
                    delivered_at: r.delivered_at,
                    responded_at: r.responded_at,
                    response_message: r.response_message,
                }));
            }

            // Signatures
            if (sections.includes('signatures')) {
                const recipientIds = recipients.map(r => r.id);
                const signatures = await fetchSignatures(env, recipientIds);

                data.signatures = signatures.map(s => {
                    const recipient = recipients.find(r => r.id === s.recipient_id);
                    return {
                        recipient_id: s.recipient_id,
                        recipient_identifier: recipient?.counterparty_identifier || 'Unknown',
                        signature_type: s.signature_type,
                        signature: s.signature,
                        message_hash: s.message_hash,
                        signer_address: s.signer_address,
                        verified: s.verified,
                        verification_error: s.verification_error,
                        signed_at: s.signed_at,
                    };
                });
            }

            // Audit trail
            if (sections.includes('audit_trail')) {
                const auditExport = await exportBundleAuditTrail(env, targetId);
                data.audit_trail = {
                    events: auditExport.events,
                    hash: auditExport.hash,
                };
            }

            // Blockchain anchor
            if (sections.includes('blockchain_proof')) {
                const anchor = await fetchBlockchainAnchor(env, bundle.evidence_hash);
                if (anchor) {
                    data.blockchain_anchor = anchor;
                    data.verification.blockchain_explorer_url = anchor.explorer_url;
                }
            }
        }
    }

    // Fetch challenge data
    if (sections.includes('challenge')) {
        // For ENF bundles, we may not have a direct challenge link
        // For challenges, use the target ID directly
        const challengeId = targetType === 'CHALLENGE' ? targetId : undefined;

        if (challengeId) {
            const challenge = await fetchChallenge(env, challengeId);
            if (challenge) {
                data.challenge = {
                    id: challenge.id,
                    mode: challenge.mode,
                    title: challenge.title,
                    description: challenge.description,
                    status: challenge.status,
                    creator_user_id: challenge.creator_user_id,
                    counterparty_user_id: challenge.counterparty_user_id,
                    created_at: challenge.created_at,
                    resolved_at: challenge.resolved_at,
                };

                // Fetch dispute if section included
                if (sections.includes('dispute')) {
                    const dispute = await fetchDispute(env, challengeId);
                    if (dispute) {
                        data.dispute = {
                            id: dispute.id,
                            challenge_id: dispute.challenge_id,
                            raised_by_user_id: dispute.raised_by_user_id,
                            reason: dispute.reason,
                            evidence: dispute.evidence ? JSON.parse(dispute.evidence) : undefined,
                            status: dispute.status,
                            winner_user_id: dispute.winner_user_id,
                            resolution: dispute.resolution,
                            resolved_at: dispute.resolved_at,
                            created_at: dispute.created_at,
                        };
                    }
                }
            }
        }
    }

    // Risk assessment
    if (sections.includes('risk_assessment')) {
        const llmTargetType = targetType === 'ENF_BUNDLE' ? 'ENF_BUNDLE' : 'CHALLENGE';
        const { analysis, flags } = await fetchLlmAnalysis(env, llmTargetType, targetId);

        if (analysis) {
            data.risk_assessment = {
                analysis_id: analysis.id,
                risk_score: analysis.risk_score,
                risk_level: analysis.risk_level,
                recommendation: analysis.recommendation,
                summary: analysis.summary,
                flags: flags.map(f => ({
                    flag_type: f.flag_type,
                    severity: f.severity,
                    title: f.title,
                    description: f.description,
                })),
                analyzed_at: analysis.completed_at,
            };
        } else {
            // Try to get just the risk score
            const entityType = targetType === 'CHALLENGE' ? 'CHALLENGE' : 'CHALLENGE';
            const riskScore = await fetchRiskScore(env, entityType, targetId);
            if (riskScore) {
                data.risk_assessment = {
                    risk_score: riskScore.score,
                    risk_level: riskScore.risk_level,
                    flags: [],
                    analyzed_at: riskScore.calculated_at,
                };
            }
        }
    }

    // Compute content hash
    const contentForHash = JSON.stringify({
        enf_bundle: data.enf_bundle,
        recipients: data.recipients,
        signatures: data.signatures,
        audit_trail: data.audit_trail,
        challenge: data.challenge,
        dispute: data.dispute,
        risk_assessment: data.risk_assessment,
        blockchain_anchor: data.blockchain_anchor,
        exported_at: data.exported_at,
    });
    data.content_hash = await computeHash(contentForHash);
    data.verification.document_hash = data.content_hash;

    // Generate verification URL for QR code
    data.verification.qr_code_data = generateVerificationUrl(
        verificationBaseUrl,
        data.content_hash,
        targetType,
        targetId
    );

    return data;
}
