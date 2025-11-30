/**
 * PDF Dossier R2 Caching
 *
 * Caches generated PDFs in R2 for fast retrieval.
 * Cache key is based on content hash to ensure consistency.
 */

import type { Env } from '../types';

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate cache key for a dossier PDF.
 */
export function generateCacheKey(
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string,
    contentHash: string
): string {
    return `dossier/${targetType.toLowerCase()}/${targetId}/${contentHash}.pdf`;
}

/**
 * Generate metadata key for tracking cache entries.
 */
export function generateMetadataKey(
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string
): string {
    return `dossier-meta/${targetType.toLowerCase()}/${targetId}`;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Cache metadata stored alongside PDFs.
 */
export interface PdfCacheMetadata {
    targetType: 'ENF_BUNDLE' | 'CHALLENGE';
    targetId: string;
    contentHash: string;
    exportId: string;
    generatedAt: string;
    sizeBytes: number;
    intent: string;
}

/**
 * Get cached PDF from R2.
 * Returns null if not found or R2 not configured.
 */
export async function getCachedPdf(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string,
    contentHash: string
): Promise<{ data: ArrayBuffer; metadata: PdfCacheMetadata } | null> {
    if (!env.TATTLEHASH_PDF_BUCKET) {
        return null;
    }

    const cacheKey = generateCacheKey(targetType, targetId, contentHash);

    try {
        const object = await env.TATTLEHASH_PDF_BUCKET.get(cacheKey);
        if (!object) {
            return null;
        }

        const data = await object.arrayBuffer();
        const metadata = object.customMetadata as unknown as PdfCacheMetadata;

        return { data, metadata };
    } catch (error) {
        console.error('R2 cache get error:', error);
        return null;
    }
}

/**
 * Store PDF in R2 cache.
 */
export async function cachePdf(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string,
    contentHash: string,
    pdfData: Uint8Array,
    metadata: Omit<PdfCacheMetadata, 'sizeBytes'>
): Promise<boolean> {
    if (!env.TATTLEHASH_PDF_BUCKET) {
        return false;
    }

    const cacheKey = generateCacheKey(targetType, targetId, contentHash);

    try {
        await env.TATTLEHASH_PDF_BUCKET.put(cacheKey, pdfData, {
            httpMetadata: {
                contentType: 'application/pdf',
                contentDisposition: `attachment; filename="TattleHash_${targetType}_${targetId.slice(0, 8)}.pdf"`,
            },
            customMetadata: {
                ...metadata,
                sizeBytes: pdfData.length.toString(),
            } as Record<string, string>,
        });

        // Also store metadata reference for invalidation lookups
        const metaKey = generateMetadataKey(targetType, targetId);
        await env.TATTLEHASH_PDF_BUCKET.put(metaKey, JSON.stringify({
            currentHash: contentHash,
            cacheKey,
            updatedAt: new Date().toISOString(),
        }), {
            httpMetadata: { contentType: 'application/json' },
        });

        return true;
    } catch (error) {
        console.error('R2 cache put error:', error);
        return false;
    }
}

/**
 * Invalidate cached PDF for a target.
 * Call this when the underlying data changes.
 */
export async function invalidatePdfCache(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string
): Promise<boolean> {
    if (!env.TATTLEHASH_PDF_BUCKET) {
        return false;
    }

    const metaKey = generateMetadataKey(targetType, targetId);

    try {
        // Get current cache reference
        const metaObject = await env.TATTLEHASH_PDF_BUCKET.get(metaKey);
        if (metaObject) {
            const metaText = await metaObject.text();
            const meta = JSON.parse(metaText);

            // Delete the cached PDF
            if (meta.cacheKey) {
                await env.TATTLEHASH_PDF_BUCKET.delete(meta.cacheKey);
            }

            // Delete the metadata reference
            await env.TATTLEHASH_PDF_BUCKET.delete(metaKey);
        }

        return true;
    } catch (error) {
        console.error('R2 cache invalidation error:', error);
        return false;
    }
}

/**
 * Check if a cached version exists with matching hash.
 */
export async function hasCachedPdf(
    env: Env,
    targetType: 'ENF_BUNDLE' | 'CHALLENGE',
    targetId: string,
    contentHash: string
): Promise<boolean> {
    if (!env.TATTLEHASH_PDF_BUCKET) {
        return false;
    }

    const cacheKey = generateCacheKey(targetType, targetId, contentHash);

    try {
        const head = await env.TATTLEHASH_PDF_BUCKET.head(cacheKey);
        return head !== null;
    } catch {
        return false;
    }
}

/**
 * Get cache statistics for monitoring.
 */
export async function getCacheStats(
    env: Env
): Promise<{ enabled: boolean; prefix: string }> {
    return {
        enabled: !!env.TATTLEHASH_PDF_BUCKET,
        prefix: 'dossier/',
    };
}
