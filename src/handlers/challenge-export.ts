/**
 * Challenge PDF Export Handler
 *
 * Export challenges as PDF dossiers.
 */

import { ok, err } from '../lib/http';
import { requireAuth, getAuthContext } from '../middleware/auth';
import type { Env } from '../types';
import {
    INTENT_SECTIONS,
    aggregateDossierData,
    generateDossierPdf,
} from '../dossier';
import { getCachedPdf, cachePdf, hasCachedPdf } from '../dossier/cache';
import type { DossierSection } from '../dossier';
import { query, queryOne } from '../db';
import type { Challenge } from '../db/types';

// ============================================================================
// GET /challenges/:id/export/pdf - Export challenge as PDF dossier
// ============================================================================

export async function getChallengeExportPdf(
    req: Request,
    env: Env,
    challengeId: string
): Promise<Response> {
    // Require authentication
    const authError = await requireAuth(req, env);
    if (authError) {
        return authError;
    }
    const authContext = await getAuthContext(req, env);
    const userId = authContext.userId;

    // Get intent from query params (default to 'dispute')
    const url = new URL(req.url);
    const intent = (url.searchParams.get('intent') || 'dispute') as 'evidence' | 'dispute' | 'legal_package';
    const skipCache = url.searchParams.get('nocache') === 'true';

    // Validate intent
    if (!['evidence', 'dispute', 'legal_package'].includes(intent)) {
        return err(400, 'invalid_intent', {
            message: 'Intent must be one of: evidence, dispute, legal_package',
        });
    }

    // Verify challenge exists and user has access
    const challenge = await queryOne<Challenge>(
        env.TATTLEHASH_DB,
        'SELECT * FROM challenges WHERE id = ?',
        [challengeId]
    );

    if (!challenge) {
        return err(404, 'challenge_not_found', { challenge_id: challengeId });
    }

    // Check user has access (creator or counterparty)
    if (challenge.creator_user_id !== userId && challenge.counterparty_user_id !== userId) {
        return err(403, 'forbidden', {
            message: 'You do not have access to this challenge',
        });
    }

    const sections = [...INTENT_SECTIONS[intent]];

    try {
        // Aggregate data first to get content hash
        const dossierData = await aggregateDossierData(
            env,
            'CHALLENGE',
            challengeId,
            intent,
            sections,
            userId
        );

        // Add challenge data since aggregator may not have it for CHALLENGE type
        if (!dossierData.challenge) {
            dossierData.challenge = {
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
        }

        // Try to get from cache
        if (!skipCache) {
            const cached = await getCachedPdf(
                env,
                'CHALLENGE',
                challengeId,
                dossierData.content_hash
            );

            if (cached) {
                const timestamp = new Date().toISOString().slice(0, 10);
                const shortId = challengeId.slice(0, 8);
                const filename = `TattleHash_Challenge_${shortId}_${timestamp}.pdf`;

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
            'CHALLENGE',
            challengeId,
            dossierData.content_hash,
            pdfBytes,
            {
                targetType: 'CHALLENGE',
                targetId: challengeId,
                contentHash: dossierData.content_hash,
                exportId: dossierData.export_id,
                generatedAt: dossierData.exported_at,
                intent,
            }
        );

        const timestamp = new Date().toISOString().slice(0, 10);
        const shortId = challengeId.slice(0, 8);
        const filename = `TattleHash_Challenge_${shortId}_${timestamp}.pdf`;

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
        console.error('Challenge PDF export failed:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err(500, 'export_failed', { message });
    }
}
