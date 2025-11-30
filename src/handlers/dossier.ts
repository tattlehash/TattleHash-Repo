/**
 * Dossier Export HTTP Handlers
 *
 * Endpoints for generating and downloading PDF dossiers.
 */

import { ok, err, parseBody } from '../lib/http';
import { requireAuth, getAuthContext } from '../middleware/auth';
import type { Env } from '../types';
import {
    DossierExportRequestSchema,
    INTENT_SECTIONS,
    aggregateDossierData,
    generateDossierPdf,
} from '../dossier';
import type { DossierSection, DossierExportResponse } from '../dossier';

// ============================================================================
// POST /dossier/export - Generate and download PDF dossier
// ============================================================================

export async function postExportDossier(
    req: Request,
    env: Env
): Promise<Response> {
    // Require authentication
    const authError = await requireAuth(req, env);
    if (authError) {
        return authError;
    }
    const authContext = await getAuthContext(req, env);
    const userId = authContext.userId;

    // Parse and validate request body
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'invalid_json', { message: bodyResult.error });
    }

    const parseResult = DossierExportRequestSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'validation_error', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    const input = parseResult.data;

    // Determine sections based on intent
    let sections: DossierSection[];
    if (input.intent === 'custom' && input.sections) {
        sections = input.sections;
        // Always include verification
        if (!sections.includes('verification')) {
            sections.push('verification');
        }
    } else {
        sections = [...INTENT_SECTIONS[input.intent]];
    }

    // Add raw_data if requested
    if (input.include_raw_data && !sections.includes('raw_data')) {
        sections.push('raw_data');
    }

    try {
        // Aggregate all data
        const dossierData = await aggregateDossierData(
            env,
            input.target_type,
            input.target_id,
            input.intent,
            sections,
            userId
        );

        // Validate we have required data
        if (input.target_type === 'ENF_BUNDLE' && !dossierData.enf_bundle) {
            return err(404, 'bundle_not_found', { bundle_id: input.target_id });
        }

        // Generate PDF
        const pdfBytes = await generateDossierPdf(dossierData);

        // Create filename
        const timestamp = new Date().toISOString().slice(0, 10);
        const shortId = input.target_id.slice(0, 8);
        const filename = `TattleHash_Dossier_${input.target_type}_${shortId}_${timestamp}.pdf`;

        // Return PDF as download (convert Uint8Array to ArrayBuffer for Response)
        return new Response(pdfBytes.buffer as ArrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': pdfBytes.length.toString(),
                'X-Document-Hash': dossierData.content_hash,
                'X-Export-Id': dossierData.export_id,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('Dossier export failed:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(500, 'export_failed', { message });
    }
}

// ============================================================================
// POST /dossier/export/metadata - Get export metadata without generating PDF
// ============================================================================

export async function postExportMetadata(
    req: Request,
    env: Env
): Promise<Response> {
    // Require authentication
    const authError = await requireAuth(req, env);
    if (authError) {
        return authError;
    }
    const authContext = await getAuthContext(req, env);
    const userId = authContext.userId;

    // Parse and validate request body
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'invalid_json', { message: bodyResult.error });
    }

    const parseResult = DossierExportRequestSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'validation_error', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    const input = parseResult.data;

    // Determine sections based on intent
    let sections: DossierSection[];
    if (input.intent === 'custom' && input.sections) {
        sections = input.sections;
        if (!sections.includes('verification')) {
            sections.push('verification');
        }
    } else {
        sections = [...INTENT_SECTIONS[input.intent]];
    }

    if (input.include_raw_data && !sections.includes('raw_data')) {
        sections.push('raw_data');
    }

    try {
        // Aggregate data (without generating PDF)
        const dossierData = await aggregateDossierData(
            env,
            input.target_type,
            input.target_id,
            input.intent,
            sections,
            userId
        );

        if (input.target_type === 'ENF_BUNDLE' && !dossierData.enf_bundle) {
            return err(404, 'bundle_not_found', { bundle_id: input.target_id });
        }

        // Return metadata
        const response: DossierExportResponse = {
            export_id: dossierData.export_id,
            target_type: input.target_type,
            target_id: input.target_id,
            document_hash: dossierData.content_hash,
            exported_at: dossierData.exported_at,
            verification_url: dossierData.verification.qr_code_data,
        };

        return ok(response);
    } catch (error) {
        console.error('Dossier metadata export failed:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(500, 'export_failed', { message });
    }
}

// ============================================================================
// GET /dossier/intents - List available export intents
// ============================================================================

export async function getExportIntents(
    _req: Request,
    _env: Env
): Promise<Response> {
    const intents = [
        {
            id: 'evidence',
            name: 'Evidence of what happened',
            description: 'ENF bundle with signatures and audit trail',
            sections: INTENT_SECTIONS.evidence,
        },
        {
            id: 'dispute',
            name: 'Dispute documentation',
            description: 'Evidence plus Challenge and Dispute records',
            sections: INTENT_SECTIONS.dispute,
        },
        {
            id: 'legal_package',
            name: 'Complete legal package',
            description: 'Full suite including risk assessment and raw data',
            sections: INTENT_SECTIONS.legal_package,
        },
        {
            id: 'custom',
            name: 'Custom',
            description: 'Select specific sections to include',
            sections: [],
        },
    ];

    const availableSections = [
        { id: 'cover', name: 'Cover Page', description: 'Case summary and export metadata' },
        { id: 'toc', name: 'Table of Contents', description: 'Document navigation' },
        { id: 'evidence_overview', name: 'Evidence Overview', description: 'Bundle details and recipient summary' },
        { id: 'recipients', name: 'Recipients', description: 'Detailed recipient status' },
        { id: 'signatures', name: 'Signatures', description: 'Cryptographic signature details' },
        { id: 'audit_trail', name: 'Audit Trail', description: 'Complete event history' },
        { id: 'challenge', name: 'Challenge', description: 'Challenge details (if applicable)' },
        { id: 'dispute', name: 'Dispute', description: 'Dispute information (if applicable)' },
        { id: 'risk_assessment', name: 'Risk Assessment', description: 'LLM analysis and flags' },
        { id: 'blockchain_proof', name: 'Blockchain Proof', description: 'On-chain anchor details' },
        { id: 'verification', name: 'Verification', description: 'How to verify this document (always included)' },
        { id: 'raw_data', name: 'Raw Data', description: 'Machine-readable evidence payload' },
    ];

    return ok({ intents, available_sections: availableSections });
}

// ============================================================================
// GET /enf/bundles/:id/export/pdf - Convenience endpoint for ENF bundle export
// ============================================================================

import { getCachedPdf, cachePdf } from '../dossier/cache';

export async function getEnfBundleExportPdf(
    req: Request,
    env: Env,
    bundleId: string
): Promise<Response> {
    // Require authentication
    const authError = await requireAuth(req, env);
    if (authError) {
        return authError;
    }
    const authContext = await getAuthContext(req, env);
    const userId = authContext.userId;

    // Get intent from query params (default to 'evidence')
    const url = new URL(req.url);
    const intent = (url.searchParams.get('intent') || 'evidence') as 'evidence' | 'dispute' | 'legal_package';
    const skipCache = url.searchParams.get('nocache') === 'true';

    // Validate intent
    if (!['evidence', 'dispute', 'legal_package'].includes(intent)) {
        return err(400, 'invalid_intent', {
            message: 'Intent must be one of: evidence, dispute, legal_package',
        });
    }

    const sections = [...INTENT_SECTIONS[intent]];

    try {
        const dossierData = await aggregateDossierData(
            env,
            'ENF_BUNDLE',
            bundleId,
            intent,
            sections,
            userId
        );

        if (!dossierData.enf_bundle) {
            return err(404, 'bundle_not_found', { bundle_id: bundleId });
        }

        // Try to get from cache
        if (!skipCache) {
            const cached = await getCachedPdf(
                env,
                'ENF_BUNDLE',
                bundleId,
                dossierData.content_hash
            );

            if (cached) {
                const timestamp = new Date().toISOString().slice(0, 10);
                const shortId = bundleId.slice(0, 8);
                const filename = `TattleHash_ENF_${shortId}_${timestamp}.pdf`;

                return new Response(cached.data, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': `attachment; filename="${filename}"`,
                        'Content-Length': cached.data.byteLength.toString(),
                        'X-Document-Hash': dossierData.content_hash,
                        'X-Export-Id': cached.metadata?.exportId || dossierData.export_id,
                        'X-Cache-Status': 'HIT',
                        'Cache-Control': 'no-store',
                    },
                });
            }
        }

        // Generate PDF
        const pdfBytes = await generateDossierPdf(dossierData);

        // Cache the PDF
        await cachePdf(
            env,
            'ENF_BUNDLE',
            bundleId,
            dossierData.content_hash,
            pdfBytes,
            {
                targetType: 'ENF_BUNDLE',
                targetId: bundleId,
                contentHash: dossierData.content_hash,
                exportId: dossierData.export_id,
                generatedAt: dossierData.exported_at,
                intent,
            }
        );

        const timestamp = new Date().toISOString().slice(0, 10);
        const shortId = bundleId.slice(0, 8);
        const filename = `TattleHash_ENF_${shortId}_${timestamp}.pdf`;

        return new Response(pdfBytes.buffer as ArrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': pdfBytes.length.toString(),
                'X-Document-Hash': dossierData.content_hash,
                'X-Export-Id': dossierData.export_id,
                'X-Cache-Status': 'MISS',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('ENF bundle PDF export failed:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(500, 'export_failed', { message });
    }
}
