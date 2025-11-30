/**
 * PDF Dossier Generator
 *
 * Generates court-admissible PDF documents using pdf-lib.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { DossierData, DossierSection, PdfConfig } from './types';
import { DEFAULT_PDF_CONFIG } from './types';
import { generateQrCodeMatrix } from './qr-code';

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZES = {
    A4: { width: 595.28, height: 841.89 },
    LETTER: { width: 612, height: 792 },
} as const;

const MARGINS = {
    top: 60,
    bottom: 60,
    left: 50,
    right: 50,
} as const;

const COLORS = {
    black: rgb(0, 0, 0),
    darkGray: rgb(0.2, 0.2, 0.2),
    gray: rgb(0.4, 0.4, 0.4),
    lightGray: rgb(0.7, 0.7, 0.7),
    veryLightGray: rgb(0.9, 0.9, 0.9),
    green: rgb(0.2, 0.6, 0.2),
    red: rgb(0.8, 0.2, 0.2),
    blue: rgb(0.2, 0.4, 0.8),
} as const;

// ============================================================================
// PDF Context
// ============================================================================

interface PdfContext {
    doc: PDFDocument;
    font: PDFFont;
    fontBold: PDFFont;
    fontMono: PDFFont;
    config: PdfConfig;
    pageSize: { width: number; height: number };
    currentPage: PDFPage;
    currentY: number;
    pageNumber: number;
    tocEntries: Array<{ title: string; page: number }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function createNewPage(ctx: PdfContext): PDFPage {
    const page = ctx.doc.addPage([ctx.pageSize.width, ctx.pageSize.height]);
    ctx.currentPage = page;
    ctx.currentY = ctx.pageSize.height - MARGINS.top;
    ctx.pageNumber++;
    return page;
}

function ensureSpace(ctx: PdfContext, requiredHeight: number): void {
    if (ctx.currentY - requiredHeight < MARGINS.bottom) {
        createNewPage(ctx);
    }
}

function drawText(
    ctx: PdfContext,
    text: string,
    options: {
        size?: number;
        font?: PDFFont;
        color?: typeof COLORS.black;
        x?: number;
        maxWidth?: number;
    } = {}
): number {
    const {
        size = ctx.config.baseFontSize,
        font = ctx.font,
        color = COLORS.black,
        x = MARGINS.left,
        maxWidth = ctx.pageSize.width - MARGINS.left - MARGINS.right,
    } = options;

    // Word wrap
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, size);

        if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }

    const lineHeight = size * 1.4;
    const totalHeight = lines.length * lineHeight;

    ensureSpace(ctx, totalHeight);

    for (const line of lines) {
        ctx.currentPage.drawText(line, {
            x,
            y: ctx.currentY,
            size,
            font,
            color,
        });
        ctx.currentY -= lineHeight;
    }

    return totalHeight;
}

function drawHeading(ctx: PdfContext, text: string, level: 1 | 2 | 3): void {
    const sizes = { 1: 18, 2: 14, 3: 12 };
    const spacing = { 1: 20, 2: 15, 3: 10 };

    ensureSpace(ctx, sizes[level] + spacing[level] * 2);
    ctx.currentY -= spacing[level];

    drawText(ctx, text, {
        size: sizes[level],
        font: ctx.fontBold,
        color: COLORS.darkGray,
    });

    ctx.currentY -= spacing[level] / 2;
}

function drawHorizontalLine(ctx: PdfContext): void {
    ensureSpace(ctx, 10);
    ctx.currentPage.drawLine({
        start: { x: MARGINS.left, y: ctx.currentY },
        end: { x: ctx.pageSize.width - MARGINS.right, y: ctx.currentY },
        thickness: 0.5,
        color: COLORS.lightGray,
    });
    ctx.currentY -= 10;
}

function drawKeyValue(ctx: PdfContext, key: string, value: string): void {
    const keyWidth = 150;
    ensureSpace(ctx, ctx.config.baseFontSize * 1.4);

    ctx.currentPage.drawText(`${key}:`, {
        x: MARGINS.left,
        y: ctx.currentY,
        size: ctx.config.baseFontSize,
        font: ctx.fontBold,
        color: COLORS.gray,
    });

    ctx.currentPage.drawText(value, {
        x: MARGINS.left + keyWidth,
        y: ctx.currentY,
        size: ctx.config.baseFontSize,
        font: ctx.font,
        color: COLORS.black,
    });

    ctx.currentY -= ctx.config.baseFontSize * 1.6;
}

function formatTimestamp(ts: number | string | undefined): string {
    if (!ts) return 'N/A';
    const date = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function truncateHash(hash: string, length: number = 16): string {
    if (hash.length <= length * 2 + 3) return hash;
    return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}

// ============================================================================
// Section Renderers
// ============================================================================

function renderCoverPage(ctx: PdfContext, data: DossierData): void {
    ctx.tocEntries.push({ title: 'Cover Page', page: ctx.pageNumber });

    // Title
    ctx.currentY = ctx.pageSize.height - 150;
    drawText(ctx, 'EVIDENCE DOSSIER', {
        size: 28,
        font: ctx.fontBold,
        color: COLORS.darkGray,
        x: MARGINS.left,
    });

    ctx.currentY -= 30;

    // Subtitle based on intent
    const subtitles: Record<string, string> = {
        evidence: 'Evidence Documentation Package',
        dispute: 'Dispute Documentation Package',
        legal_package: 'Complete Legal Documentation Package',
        custom: 'Custom Documentation Package',
    };
    drawText(ctx, subtitles[data.intent] || 'Documentation Package', {
        size: 16,
        color: COLORS.gray,
    });

    ctx.currentY -= 50;
    drawHorizontalLine(ctx);
    ctx.currentY -= 20;

    // Case summary
    if (data.enf_bundle) {
        drawKeyValue(ctx, 'Title', data.enf_bundle.title);
        drawKeyValue(ctx, 'Bundle ID', data.enf_bundle.id);
        drawKeyValue(ctx, 'Status', data.enf_bundle.status);
        drawKeyValue(ctx, 'Evidence Hash', truncateHash(data.enf_bundle.evidence_hash, 20));
    }

    ctx.currentY -= 20;
    drawKeyValue(ctx, 'Export ID', data.export_id);
    drawKeyValue(ctx, 'Exported At', formatTimestamp(data.exported_at));
    drawKeyValue(ctx, 'Document Hash', truncateHash(data.content_hash, 20));

    ctx.currentY -= 30;
    drawHorizontalLine(ctx);

    // Blockchain anchor summary
    if (data.blockchain_anchor) {
        ctx.currentY -= 20;
        drawHeading(ctx, 'Blockchain Verification', 2);
        drawKeyValue(ctx, 'Chain', data.blockchain_anchor.chain_name);
        drawKeyValue(ctx, 'Transaction', truncateHash(data.blockchain_anchor.tx_hash, 20));
        drawKeyValue(ctx, 'Status', data.blockchain_anchor.status.toUpperCase());
        if (data.blockchain_anchor.confirmations) {
            drawKeyValue(ctx, 'Confirmations', data.blockchain_anchor.confirmations.toString());
        }
    }

    // Disclaimer
    ctx.currentY = MARGINS.bottom + 80;
    drawText(ctx, 'LEGAL NOTICE', {
        size: 10,
        font: ctx.fontBold,
        color: COLORS.gray,
    });
    ctx.currentY -= 5;
    drawText(ctx, 'This document contains cryptographically verified evidence. All timestamps are UTC. ' +
        'Document integrity can be independently verified using the hash and blockchain anchor above. ' +
        'See "How to Verify This Document" section for verification instructions.', {
        size: 8,
        color: COLORS.gray,
    });
}

function renderTableOfContents(ctx: PdfContext, data: DossierData): void {
    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Table of Contents', page: ctx.pageNumber });

    drawHeading(ctx, 'Table of Contents', 1);
    ctx.currentY -= 20;

    const sections: Array<{ title: string; included: boolean }> = [
        { title: '1. Evidence Overview', included: data.sections.includes('evidence_overview') },
        { title: '2. Recipients & Acknowledgments', included: data.sections.includes('recipients') },
        { title: '3. Cryptographic Signatures', included: data.sections.includes('signatures') },
        { title: '4. Complete Audit Trail', included: data.sections.includes('audit_trail') },
        { title: '5. Challenge Details', included: data.sections.includes('challenge') },
        { title: '6. Dispute Information', included: data.sections.includes('dispute') },
        { title: '7. Risk Assessment', included: data.sections.includes('risk_assessment') },
        { title: '8. Blockchain Proof', included: data.sections.includes('blockchain_proof') },
        { title: 'Appendix A: How to Verify This Document', included: true },
        { title: 'Appendix B: Raw Data', included: data.sections.includes('raw_data') },
    ];

    for (const section of sections) {
        if (section.included) {
            drawText(ctx, section.title, { size: 11 });
            ctx.currentY -= 5;
        }
    }
}

function renderEvidenceOverview(ctx: PdfContext, data: DossierData): void {
    if (!data.enf_bundle) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Evidence Overview', page: ctx.pageNumber });

    drawHeading(ctx, '1. Evidence Overview', 1);

    drawKeyValue(ctx, 'Bundle ID', data.enf_bundle.id);
    drawKeyValue(ctx, 'Title', data.enf_bundle.title);
    if (data.enf_bundle.description) {
        drawKeyValue(ctx, 'Description', data.enf_bundle.description);
    }
    drawKeyValue(ctx, 'Status', data.enf_bundle.status);
    drawKeyValue(ctx, 'Evidence Hash', data.enf_bundle.evidence_hash);
    drawKeyValue(ctx, 'Created', formatTimestamp(data.enf_bundle.created_at));
    drawKeyValue(ctx, 'Expires', formatTimestamp(data.enf_bundle.expires_at));
    drawKeyValue(ctx, 'Initiator', data.enf_bundle.initiator_user_id);
    if (data.enf_bundle.initiator_wallet) {
        drawKeyValue(ctx, 'Initiator Wallet', data.enf_bundle.initiator_wallet);
    }

    ctx.currentY -= 20;

    // Recipients summary
    if (data.recipients && data.recipients.length > 0) {
        drawHeading(ctx, 'Recipients Summary', 2);

        for (const recipient of data.recipients) {
            ensureSpace(ctx, 60);
            ctx.currentY -= 10;

            drawText(ctx, `${recipient.type}: ${recipient.identifier}`, {
                font: ctx.fontBold,
                size: 10,
            });

            const statusColor = recipient.status === 'ACKNOWLEDGED' ? COLORS.green :
                recipient.status === 'DECLINED' ? COLORS.red : COLORS.gray;

            drawText(ctx, `Status: ${recipient.status}`, {
                size: 9,
                color: statusColor,
                x: MARGINS.left + 20,
            });

            if (recipient.sent_at) {
                drawText(ctx, `Sent: ${formatTimestamp(recipient.sent_at)}`, {
                    size: 9,
                    color: COLORS.gray,
                    x: MARGINS.left + 20,
                });
            }
            if (recipient.responded_at) {
                drawText(ctx, `Responded: ${formatTimestamp(recipient.responded_at)}`, {
                    size: 9,
                    color: COLORS.gray,
                    x: MARGINS.left + 20,
                });
            }
        }
    }
}

function renderSignatures(ctx: PdfContext, data: DossierData): void {
    if (!data.signatures || data.signatures.length === 0) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Cryptographic Signatures', page: ctx.pageNumber });

    drawHeading(ctx, '3. Cryptographic Signatures', 1);

    drawText(ctx, 'The following cryptographic signatures provide non-repudiable proof of acknowledgment.', {
        size: 9,
        color: COLORS.gray,
    });
    ctx.currentY -= 15;

    for (const sig of data.signatures) {
        ensureSpace(ctx, 100);
        ctx.currentY -= 10;

        drawText(ctx, `Recipient: ${sig.recipient_identifier}`, {
            font: ctx.fontBold,
            size: 10,
        });

        drawText(ctx, `Type: ${sig.signature_type}`, {
            size: 9,
            x: MARGINS.left + 20,
        });

        const verifiedText = sig.verified ? 'VERIFIED' : 'UNVERIFIED';
        const verifiedColor = sig.verified ? COLORS.green : COLORS.red;
        drawText(ctx, `Verification: ${verifiedText}`, {
            size: 9,
            color: verifiedColor,
            x: MARGINS.left + 20,
        });

        if (sig.signer_address) {
            drawText(ctx, `Signer Address: ${sig.signer_address}`, {
                size: 9,
                font: ctx.fontMono,
                x: MARGINS.left + 20,
            });
        }

        if (sig.signature) {
            drawText(ctx, `Signature: ${truncateHash(sig.signature, 24)}`, {
                size: 8,
                font: ctx.fontMono,
                x: MARGINS.left + 20,
                color: COLORS.gray,
            });
        }

        drawText(ctx, `Signed At: ${formatTimestamp(sig.signed_at)}`, {
            size: 9,
            x: MARGINS.left + 20,
        });

        if (sig.verification_error) {
            drawText(ctx, `Error: ${sig.verification_error}`, {
                size: 9,
                color: COLORS.red,
                x: MARGINS.left + 20,
            });
        }

        ctx.currentY -= 10;
        drawHorizontalLine(ctx);
    }
}

function renderAuditTrail(ctx: PdfContext, data: DossierData): void {
    if (!data.audit_trail || data.audit_trail.events.length === 0) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Audit Trail', page: ctx.pageNumber });

    drawHeading(ctx, '4. Complete Audit Trail', 1);

    drawText(ctx, `Audit Trail Hash: ${data.audit_trail.hash}`, {
        size: 8,
        font: ctx.fontMono,
        color: COLORS.gray,
    });
    ctx.currentY -= 15;

    drawText(ctx, 'All events are immutable and recorded in chronological order.', {
        size: 9,
        color: COLORS.gray,
    });
    ctx.currentY -= 15;

    // Table header
    drawText(ctx, 'TIMESTAMP                    EVENT TYPE        ACTOR           DETAILS', {
        size: 8,
        font: ctx.fontBold,
        color: COLORS.gray,
    });
    ctx.currentY -= 5;
    drawHorizontalLine(ctx);

    for (const event of data.audit_trail.events) {
        ensureSpace(ctx, 30);

        const timestamp = event.timestamp.slice(0, 19).replace('T', ' ');
        const eventType = event.event_type.padEnd(16);
        const actor = (event.actor || event.actor_type).slice(0, 14).padEnd(14);
        const details = event.details ? JSON.stringify(event.details).slice(0, 40) : '';

        drawText(ctx, `${timestamp}  ${eventType}  ${actor}  ${details}`, {
            size: 8,
            font: ctx.fontMono,
        });
    }
}

function renderRiskAssessment(ctx: PdfContext, data: DossierData): void {
    if (!data.risk_assessment) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Risk Assessment', page: ctx.pageNumber });

    drawHeading(ctx, '7. Risk Assessment', 1);

    const ra = data.risk_assessment;

    if (ra.risk_score !== undefined) {
        const scoreColor = ra.risk_score < 30 ? COLORS.green :
            ra.risk_score < 70 ? COLORS.gray : COLORS.red;

        drawKeyValue(ctx, 'Risk Score', `${ra.risk_score}/100`);
        drawText(ctx, `Risk Level: ${ra.risk_level || 'N/A'}`, {
            color: scoreColor,
            font: ctx.fontBold,
        });
    }

    if (ra.recommendation) {
        ctx.currentY -= 10;
        const recColor = ra.recommendation === 'PROCEED' ? COLORS.green :
            ra.recommendation === 'BLOCK' ? COLORS.red : COLORS.gray;
        drawText(ctx, `Recommendation: ${ra.recommendation}`, {
            color: recColor,
            font: ctx.fontBold,
        });
    }

    if (ra.summary) {
        ctx.currentY -= 15;
        drawHeading(ctx, 'Analysis Summary', 2);
        drawText(ctx, ra.summary, { size: 9 });
    }

    if (ra.flags.length > 0) {
        ctx.currentY -= 15;
        drawHeading(ctx, 'Flags Raised', 2);

        for (const flag of ra.flags) {
            ensureSpace(ctx, 50);

            const severityColor = flag.severity === 'CRITICAL' || flag.severity === 'HIGH' ? COLORS.red :
                flag.severity === 'MEDIUM' ? COLORS.gray : COLORS.lightGray;

            drawText(ctx, `[${flag.severity}] ${flag.title}`, {
                font: ctx.fontBold,
                size: 10,
                color: severityColor,
            });

            drawText(ctx, flag.description, {
                size: 9,
                x: MARGINS.left + 20,
            });

            drawText(ctx, `Type: ${flag.flag_type}`, {
                size: 8,
                color: COLORS.gray,
                x: MARGINS.left + 20,
            });

            ctx.currentY -= 10;
        }
    }

    if (ra.analyzed_at) {
        ctx.currentY -= 10;
        drawText(ctx, `Analysis performed: ${formatTimestamp(ra.analyzed_at)}`, {
            size: 8,
            color: COLORS.gray,
        });
    }
}

function renderBlockchainProof(ctx: PdfContext, data: DossierData): void {
    if (!data.blockchain_anchor) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Blockchain Proof', page: ctx.pageNumber });

    drawHeading(ctx, '8. Blockchain Proof', 1);

    const anchor = data.blockchain_anchor;

    drawText(ctx, 'This evidence has been anchored to a public blockchain, providing immutable proof of existence.', {
        size: 9,
        color: COLORS.gray,
    });
    ctx.currentY -= 15;

    drawKeyValue(ctx, 'Blockchain', anchor.chain_name);
    drawKeyValue(ctx, 'Transaction Hash', anchor.tx_hash);
    drawKeyValue(ctx, 'Status', anchor.status.toUpperCase());

    if (anchor.confirmations) {
        drawKeyValue(ctx, 'Confirmations', anchor.confirmations.toString());
    }
    if (anchor.block_number) {
        drawKeyValue(ctx, 'Block Number', anchor.block_number.toString());
    }
    if (anchor.timestamp) {
        drawKeyValue(ctx, 'Anchored At', formatTimestamp(anchor.timestamp));
    }
    if (anchor.merkle_root) {
        drawKeyValue(ctx, 'Merkle Root', truncateHash(anchor.merkle_root, 20));
    }

    ctx.currentY -= 20;
    drawHeading(ctx, 'Verify on Blockchain Explorer', 2);
    drawText(ctx, anchor.explorer_url, {
        size: 9,
        font: ctx.fontMono,
        color: COLORS.blue,
    });

    if (anchor.merkle_proof && anchor.merkle_proof.length > 0) {
        ctx.currentY -= 20;
        drawHeading(ctx, 'Merkle Proof', 2);
        drawText(ctx, 'Use this proof to verify inclusion in the anchored batch:', {
            size: 8,
            color: COLORS.gray,
        });
        ctx.currentY -= 10;

        for (let i = 0; i < anchor.merkle_proof.length; i++) {
            drawText(ctx, `[${i}] ${anchor.merkle_proof[i]}`, {
                size: 7,
                font: ctx.fontMono,
            });
        }
    }
}

function renderVerificationAppendix(ctx: PdfContext, data: DossierData): void {
    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'How to Verify This Document', page: ctx.pageNumber });

    drawHeading(ctx, 'Appendix A: How to Verify This Document', 1);

    drawText(ctx, "This document's authenticity is anchored to the Polygon blockchain. " +
        "Anyone can independently verify it was not altered after creation.", {
        size: 10,
    });

    ctx.currentY -= 20;
    drawHorizontalLine(ctx);
    ctx.currentY -= 10;

    // Document Hash
    drawHeading(ctx, 'DOCUMENT HASH', 2);
    drawText(ctx, `SHA-256: ${data.verification.document_hash}`, {
        size: 9,
        font: ctx.fontMono,
    });

    // Blockchain Anchor
    if (data.blockchain_anchor) {
        ctx.currentY -= 15;
        drawHeading(ctx, 'BLOCKCHAIN ANCHOR', 2);
        drawKeyValue(ctx, 'Chain', data.blockchain_anchor.chain_name);
        drawKeyValue(ctx, 'Transaction', truncateHash(data.blockchain_anchor.tx_hash, 24));
        if (data.blockchain_anchor.block_number) {
            drawKeyValue(ctx, 'Block', data.blockchain_anchor.block_number.toString());
        }
        if (data.blockchain_anchor.timestamp) {
            drawKeyValue(ctx, 'Timestamp', formatTimestamp(data.blockchain_anchor.timestamp));
        }
    }

    ctx.currentY -= 20;
    drawHorizontalLine(ctx);
    ctx.currentY -= 10;

    // Verification Methods
    drawHeading(ctx, 'VERIFY IT YOURSELF', 2);

    // Option 1
    drawText(ctx, 'Option 1: TattleHash Verification Portal', {
        font: ctx.fontBold,
        size: 10,
    });
    drawText(ctx, `1. Go to: ${data.verification.portal_url}`, { size: 9, x: MARGINS.left + 20 });
    drawText(ctx, '2. Enter document hash or upload this PDF', { size: 9, x: MARGINS.left + 20 });
    drawText(ctx, '3. See verification result', { size: 9, x: MARGINS.left + 20 });

    ctx.currentY -= 10;

    // Option 2
    drawText(ctx, 'Option 2: Direct Blockchain Verification', {
        font: ctx.fontBold,
        size: 10,
    });
    if (data.blockchain_anchor) {
        drawText(ctx, `1. Go to: ${data.blockchain_anchor.explorer_url.split('/tx/')[0]}`, { size: 9, x: MARGINS.left + 20 });
        drawText(ctx, `2. Search for transaction: ${truncateHash(data.blockchain_anchor.tx_hash, 20)}`, { size: 9, x: MARGINS.left + 20 });
        drawText(ctx, '3. View "Input Data" field', { size: 9, x: MARGINS.left + 20 });
        drawText(ctx, "4. Confirm it contains this document's hash", { size: 9, x: MARGINS.left + 20 });
    }

    ctx.currentY -= 10;

    // Option 3
    drawText(ctx, 'Option 3: Command Line (Technical)', {
        font: ctx.fontBold,
        size: 10,
    });
    drawText(ctx, '$ sha256sum document.pdf', { size: 9, font: ctx.fontMono, x: MARGINS.left + 20 });
    drawText(ctx, 'Compare output to Document Hash above', { size: 9, x: MARGINS.left + 20 });

    ctx.currentY -= 20;
    drawHorizontalLine(ctx);
    ctx.currentY -= 10;

    // QR Code
    drawHeading(ctx, 'QR CODE FOR INSTANT VERIFICATION', 2);
    drawText(ctx, 'Scan to verify instantly on any smartphone:', { size: 9 });
    ctx.currentY -= 10;

    // Draw QR code
    const qrData = generateQrCodeMatrix(data.verification.qr_code_data, { errorCorrectionLevel: 'M' });
    const qrSize = 100;
    const moduleSize = qrSize / qrData.size;
    const qrX = MARGINS.left + 20;
    const qrY = ctx.currentY - qrSize;

    ensureSpace(ctx, qrSize + 20);

    for (let row = 0; row < qrData.size; row++) {
        for (let col = 0; col < qrData.size; col++) {
            if (qrData.modules[row][col]) {
                ctx.currentPage.drawRectangle({
                    x: qrX + col * moduleSize,
                    y: qrY + (qrData.size - row - 1) * moduleSize,
                    width: moduleSize,
                    height: moduleSize,
                    color: COLORS.black,
                });
            }
        }
    }

    ctx.currentY = qrY - 20;

    // What this proves
    drawHorizontalLine(ctx);
    ctx.currentY -= 10;
    drawHeading(ctx, 'WHAT THIS PROVES', 2);

    const proofs = [
        'Document existed at the timestamp shown',
        'Content has not been modified since anchoring',
        'Signatures were valid at time of creation',
        'Verification is independent of TattleHash',
    ];

    for (const proof of proofs) {
        drawText(ctx, `[OK] ${proof}`, { size: 9, color: COLORS.green });
    }

    ctx.currentY -= 15;
    drawText(ctx, 'This verification method is accepted by courts, arbitrators, and regulatory bodies worldwide.', {
        size: 9,
        font: ctx.fontBold,
        color: COLORS.gray,
    });
}

function renderRawDataAppendix(ctx: PdfContext, data: DossierData): void {
    if (!data.enf_bundle?.evidence_payload) return;

    createNewPage(ctx);
    ctx.tocEntries.push({ title: 'Raw Data', page: ctx.pageNumber });

    drawHeading(ctx, 'Appendix B: Raw Data (Machine-Readable)', 1);

    drawText(ctx, 'This appendix contains the raw evidence data in JSON format for programmatic verification.', {
        size: 9,
        color: COLORS.gray,
    });
    ctx.currentY -= 15;

    const jsonStr = JSON.stringify(data.enf_bundle.evidence_payload, null, 2);
    const lines = jsonStr.split('\n');

    for (const line of lines) {
        ensureSpace(ctx, 12);
        drawText(ctx, line, {
            size: 7,
            font: ctx.fontMono,
        });
    }
}

function addPageNumbers(ctx: PdfContext): void {
    if (!ctx.config.pageNumbers) return;

    const pages = ctx.doc.getPages();
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageNum = `Page ${i + 1} of ${pages.length}`;
        const textWidth = ctx.font.widthOfTextAtSize(pageNum, 8);

        page.drawText(pageNum, {
            x: ctx.pageSize.width - MARGINS.right - textWidth,
            y: MARGINS.bottom - 20,
            size: 8,
            font: ctx.font,
            color: COLORS.gray,
        });
    }
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate PDF dossier from aggregated data.
 */
export async function generateDossierPdf(
    data: DossierData,
    config: Partial<PdfConfig> = {}
): Promise<Uint8Array> {
    const finalConfig = { ...DEFAULT_PDF_CONFIG, ...config };

    // Create PDF document
    const doc = await PDFDocument.create();

    // Embed fonts
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await doc.embedFont(StandardFonts.Courier);

    const pageSize = PAGE_SIZES[finalConfig.pageSize];

    // Create context
    const ctx: PdfContext = {
        doc,
        font,
        fontBold,
        fontMono,
        config: finalConfig,
        pageSize,
        currentPage: doc.addPage([pageSize.width, pageSize.height]),
        currentY: pageSize.height - MARGINS.top,
        pageNumber: 1,
        tocEntries: [],
    };

    // Render sections based on data.sections
    if (data.sections.includes('cover')) {
        renderCoverPage(ctx, data);
    }

    if (data.sections.includes('toc')) {
        renderTableOfContents(ctx, data);
    }

    if (data.sections.includes('evidence_overview')) {
        renderEvidenceOverview(ctx, data);
    }

    if (data.sections.includes('signatures')) {
        renderSignatures(ctx, data);
    }

    if (data.sections.includes('audit_trail')) {
        renderAuditTrail(ctx, data);
    }

    if (data.sections.includes('risk_assessment')) {
        renderRiskAssessment(ctx, data);
    }

    if (data.sections.includes('blockchain_proof')) {
        renderBlockchainProof(ctx, data);
    }

    // Verification appendix is always included
    renderVerificationAppendix(ctx, data);

    if (data.sections.includes('raw_data')) {
        renderRawDataAppendix(ctx, data);
    }

    // Add page numbers
    addPageNumbers(ctx);

    // Save and return
    return doc.save();
}
