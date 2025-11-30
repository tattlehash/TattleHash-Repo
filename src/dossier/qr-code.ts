/**
 * QR Code Generation for PDF Dossiers
 *
 * Uses qrcode-generator for pure JS QR code generation.
 */

import qrcode from 'qrcode-generator';

/**
 * QR code configuration.
 */
export interface QrCodeOptions {
    /** Error correction level: L (7%), M (15%), Q (25%), H (30%) */
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    /** Module size in pixels (for image output) */
    moduleSize?: number;
    /** Margin in modules */
    margin?: number;
}

const DEFAULT_QR_OPTIONS: Required<QrCodeOptions> = {
    errorCorrectionLevel: 'M',
    moduleSize: 4,
    margin: 2,
};

/**
 * Generate QR code data URL (base64 PNG).
 */
export function generateQrCodeDataUrl(
    data: string,
    options: QrCodeOptions = {}
): string {
    const opts = { ...DEFAULT_QR_OPTIONS, ...options };

    // Type 0 = auto-detect version
    const qr = qrcode(0, opts.errorCorrectionLevel);
    qr.addData(data);
    qr.make();

    // Generate as data URL
    return qr.createDataURL(opts.moduleSize, opts.margin);
}

/**
 * Generate QR code as SVG string.
 */
export function generateQrCodeSvg(
    data: string,
    options: QrCodeOptions = {}
): string {
    const opts = { ...DEFAULT_QR_OPTIONS, ...options };

    const qr = qrcode(0, opts.errorCorrectionLevel);
    qr.addData(data);
    qr.make();

    return qr.createSvgTag(opts.moduleSize, opts.margin);
}

/**
 * Generate QR code as raw module matrix.
 * Useful for custom rendering in PDF.
 */
export function generateQrCodeMatrix(
    data: string,
    options: QrCodeOptions = {}
): { modules: boolean[][]; size: number } {
    const opts = { ...DEFAULT_QR_OPTIONS, ...options };

    const qr = qrcode(0, opts.errorCorrectionLevel);
    qr.addData(data);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const modules: boolean[][] = [];

    for (let row = 0; row < moduleCount; row++) {
        const rowData: boolean[] = [];
        for (let col = 0; col < moduleCount; col++) {
            rowData.push(qr.isDark(row, col));
        }
        modules.push(rowData);
    }

    return { modules, size: moduleCount };
}

/**
 * Generate verification URL with document hash.
 */
export function generateVerificationUrl(
    baseUrl: string,
    documentHash: string,
    targetType: string,
    targetId: string
): string {
    const params = new URLSearchParams({
        hash: documentHash,
        type: targetType,
        id: targetId,
    });
    return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate QR code for document verification.
 */
export function generateVerificationQrCode(
    verificationUrl: string,
    options: QrCodeOptions = {}
): { dataUrl: string; svg: string; matrix: { modules: boolean[][]; size: number } } {
    return {
        dataUrl: generateQrCodeDataUrl(verificationUrl, options),
        svg: generateQrCodeSvg(verificationUrl, options),
        matrix: generateQrCodeMatrix(verificationUrl, options),
    };
}
