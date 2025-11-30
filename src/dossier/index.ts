/**
 * Dossier Module
 *
 * PDF Dossier Export for court-admissible evidence packages.
 */

// Types
export type {
    DossierIntent,
    DossierSection,
    DossierExportRequest,
    DossierData,
    DossierExportResponse,
    BlockchainAnchor,
    SignatureRecord,
    AuditEventRecord,
    RiskAssessment,
    PdfConfig,
} from './types';

export {
    DossierIntentSchema,
    DossierSectionSchema,
    DossierExportRequestSchema,
    INTENT_SECTIONS,
    DEFAULT_PDF_CONFIG,
} from './types';

// Data aggregation
export { aggregateDossierData } from './aggregator';

// PDF generation
export { generateDossierPdf } from './pdf-generator';

// QR code utilities
export {
    generateQrCodeDataUrl,
    generateQrCodeSvg,
    generateQrCodeMatrix,
    generateVerificationUrl,
    generateVerificationQrCode,
} from './qr-code';

// R2 Caching
export {
    getCachedPdf,
    cachePdf,
    invalidatePdfCache,
    hasCachedPdf,
    generateCacheKey,
    type PdfCacheMetadata,
} from './cache';
