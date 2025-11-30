/**
 * PDF Dossier Export Tests
 *
 * Tests for dossier data aggregation, PDF generation,
 * and QR code generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DossierExportRequestSchema,
    DossierIntentSchema,
    DossierSectionSchema,
    INTENT_SECTIONS,
    DEFAULT_PDF_CONFIG,
} from '../dossier/types';
import {
    generateQrCodeDataUrl,
    generateQrCodeSvg,
    generateQrCodeMatrix,
    generateVerificationUrl,
} from '../dossier/qr-code';
import { generateDossierPdf } from '../dossier/pdf-generator';
import type { DossierData, DossierSection } from '../dossier/types';

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Dossier Schema Validation', () => {
    describe('DossierIntentSchema', () => {
        it('should accept valid intents', () => {
            expect(DossierIntentSchema.parse('evidence')).toBe('evidence');
            expect(DossierIntentSchema.parse('dispute')).toBe('dispute');
            expect(DossierIntentSchema.parse('legal_package')).toBe('legal_package');
            expect(DossierIntentSchema.parse('custom')).toBe('custom');
        });

        it('should reject invalid intents', () => {
            expect(() => DossierIntentSchema.parse('invalid')).toThrow();
            expect(() => DossierIntentSchema.parse('')).toThrow();
        });
    });

    describe('DossierSectionSchema', () => {
        it('should accept all valid sections', () => {
            const validSections = [
                'cover', 'toc', 'evidence_overview', 'recipients',
                'signatures', 'audit_trail', 'challenge', 'dispute',
                'risk_assessment', 'blockchain_proof', 'verification', 'raw_data',
            ];

            for (const section of validSections) {
                expect(DossierSectionSchema.parse(section)).toBe(section);
            }
        });

        it('should reject invalid sections', () => {
            expect(() => DossierSectionSchema.parse('invalid')).toThrow();
        });
    });

    describe('DossierExportRequestSchema', () => {
        it('should accept valid export request', () => {
            const input = {
                target_type: 'ENF_BUNDLE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
                intent: 'evidence',
            };

            const result = DossierExportRequestSchema.parse(input);
            expect(result.target_type).toBe('ENF_BUNDLE');
            expect(result.intent).toBe('evidence');
            expect(result.include_raw_data).toBe(false);
        });

        it('should accept custom intent with sections', () => {
            const input = {
                target_type: 'ENF_BUNDLE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
                intent: 'custom',
                sections: ['cover', 'evidence_overview', 'verification'],
            };

            const result = DossierExportRequestSchema.parse(input);
            expect(result.sections).toHaveLength(3);
        });

        it('should accept CHALLENGE target type', () => {
            const input = {
                target_type: 'CHALLENGE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
                intent: 'dispute',
            };

            const result = DossierExportRequestSchema.parse(input);
            expect(result.target_type).toBe('CHALLENGE');
        });

        it('should reject invalid target_id', () => {
            const input = {
                target_type: 'ENF_BUNDLE',
                target_id: 'not-a-uuid',
                intent: 'evidence',
            };

            expect(() => DossierExportRequestSchema.parse(input)).toThrow();
        });

        it('should reject invalid target_type', () => {
            const input = {
                target_type: 'INVALID',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
                intent: 'evidence',
            };

            expect(() => DossierExportRequestSchema.parse(input)).toThrow();
        });
    });
});

// ============================================================================
// Intent Sections Mapping Tests
// ============================================================================

describe('Intent to Sections Mapping', () => {
    it('should map evidence intent to correct sections', () => {
        const sections = INTENT_SECTIONS.evidence;
        expect(sections).toContain('cover');
        expect(sections).toContain('evidence_overview');
        expect(sections).toContain('audit_trail');
        expect(sections).toContain('verification');
        expect(sections).not.toContain('dispute');
        expect(sections).not.toContain('risk_assessment');
    });

    it('should map dispute intent to include challenge and dispute', () => {
        const sections = INTENT_SECTIONS.dispute;
        expect(sections).toContain('challenge');
        expect(sections).toContain('dispute');
        expect(sections).toContain('evidence_overview');
    });

    it('should map legal_package intent to include all sections', () => {
        const sections = INTENT_SECTIONS.legal_package;
        expect(sections).toContain('risk_assessment');
        expect(sections).toContain('raw_data');
        expect(sections).toContain('blockchain_proof');
    });

    it('should have empty sections for custom intent', () => {
        expect(INTENT_SECTIONS.custom).toHaveLength(0);
    });
});

// ============================================================================
// QR Code Generation Tests
// ============================================================================

describe('QR Code Generation', () => {
    describe('generateVerificationUrl', () => {
        it('should generate correct verification URL', () => {
            const url = generateVerificationUrl(
                'https://verify.tattlehash.com',
                'abc123hash',
                'ENF_BUNDLE',
                'bundle-id-123'
            );

            expect(url).toContain('https://verify.tattlehash.com');
            expect(url).toContain('hash=abc123hash');
            expect(url).toContain('type=ENF_BUNDLE');
            expect(url).toContain('id=bundle-id-123');
        });
    });

    describe('generateQrCodeDataUrl', () => {
        it('should generate a data URL', () => {
            const dataUrl = generateQrCodeDataUrl('https://example.com');
            expect(dataUrl).toMatch(/^data:image\/gif;base64,/);
        });

        it('should generate different URLs for different data', () => {
            const url1 = generateQrCodeDataUrl('data1');
            const url2 = generateQrCodeDataUrl('data2');
            expect(url1).not.toBe(url2);
        });
    });

    describe('generateQrCodeSvg', () => {
        it('should generate SVG string', () => {
            const svg = generateQrCodeSvg('https://example.com');
            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
        });
    });

    describe('generateQrCodeMatrix', () => {
        it('should generate a valid matrix', () => {
            const { modules, size } = generateQrCodeMatrix('test data');

            expect(size).toBeGreaterThan(0);
            expect(modules).toHaveLength(size);
            expect(modules[0]).toHaveLength(size);
            expect(typeof modules[0][0]).toBe('boolean');
        });

        it('should generate consistent matrix for same data', () => {
            const result1 = generateQrCodeMatrix('test');
            const result2 = generateQrCodeMatrix('test');

            expect(result1.size).toBe(result2.size);
            expect(JSON.stringify(result1.modules)).toBe(JSON.stringify(result2.modules));
        });
    });
});

// ============================================================================
// PDF Config Tests
// ============================================================================

describe('PDF Configuration', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_PDF_CONFIG.pageSize).toBe('A4');
        expect(DEFAULT_PDF_CONFIG.pageNumbers).toBe(true);
        expect(DEFAULT_PDF_CONFIG.watermark).toBe(false);
        expect(DEFAULT_PDF_CONFIG.baseFontSize).toBe(10);
    });
});

// ============================================================================
// PDF Generation Tests
// ============================================================================

describe('PDF Generation', () => {
    const createMinimalDossierData = (sections: DossierSection[] = ['cover', 'verification']): DossierData => ({
        export_id: 'test-export-123',
        exported_at: new Date().toISOString(),
        exported_by_user_id: 'user-123',
        intent: 'evidence',
        sections,
        content_hash: 'abc123def456',
        enf_bundle: {
            id: 'bundle-123',
            title: 'Test Evidence Bundle',
            description: 'A test bundle for unit testing',
            status: 'COMPLETE',
            evidence_hash: 'evidence-hash-abc',
            initiator_user_id: 'user-123',
            expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
            created_at: Date.now() - 1000000,
            updated_at: Date.now(),
        },
        recipients: [
            {
                id: 'recipient-1',
                type: 'EMAIL',
                identifier: 'test@example.com',
                status: 'ACKNOWLEDGED',
                sent_at: Date.now() - 500000,
                delivered_at: Date.now() - 400000,
                responded_at: Date.now() - 300000,
            },
        ],
        verification: {
            portal_url: 'https://verify.tattlehash.com',
            qr_code_data: 'https://verify.tattlehash.com?hash=abc123',
            document_hash: 'abc123def456',
            hash_algorithm: 'SHA-256',
        },
    });

    it('should generate a valid PDF buffer', async () => {
        const data = createMinimalDossierData();
        const pdfBytes = await generateDossierPdf(data);

        expect(pdfBytes).toBeInstanceOf(Uint8Array);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should generate PDF with correct header', async () => {
        const data = createMinimalDossierData();
        const pdfBytes = await generateDossierPdf(data);

        // PDF files start with %PDF-
        const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
        expect(header).toBe('%PDF-');
    });

    it('should generate larger PDF for more sections', async () => {
        const minimalData = createMinimalDossierData(['cover', 'verification']);
        const fullData = createMinimalDossierData([
            'cover', 'toc', 'evidence_overview', 'recipients',
            'audit_trail', 'verification',
        ]);

        // Add audit trail data
        fullData.audit_trail = {
            events: [
                {
                    timestamp: new Date().toISOString(),
                    event_type: 'CREATED',
                    actor_type: 'INITIATOR',
                    actor: 'user-123',
                    recipient_id: null,
                    details: null,
                },
                {
                    timestamp: new Date().toISOString(),
                    event_type: 'SENT',
                    actor_type: 'SYSTEM',
                    actor: null,
                    recipient_id: 'recipient-1',
                    details: { delivery_method: 'email' },
                },
            ],
            hash: 'audit-hash-123',
        };

        const minimalPdf = await generateDossierPdf(minimalData);
        const fullPdf = await generateDossierPdf(fullData);

        expect(fullPdf.length).toBeGreaterThan(minimalPdf.length);
    });

    it('should include signatures section when data is provided', async () => {
        const data = createMinimalDossierData(['cover', 'signatures', 'verification']);
        data.signatures = [
            {
                recipient_id: 'recipient-1',
                recipient_identifier: 'test@example.com',
                signature_type: 'EIP191',
                signature: '0xabc123',
                message_hash: '0xdef456',
                signer_address: '0x1234567890abcdef',
                verified: true,
                signed_at: Date.now() - 200000,
            },
        ];

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should include risk assessment section when data is provided', async () => {
        const data = createMinimalDossierData(['cover', 'risk_assessment', 'verification']);
        data.risk_assessment = {
            analysis_id: 'analysis-123',
            risk_score: 35,
            risk_level: 'LOW',
            recommendation: 'PROCEED',
            summary: 'No significant risks detected',
            flags: [
                {
                    flag_type: 'INFO',
                    severity: 'LOW',
                    title: 'New counterparty',
                    description: 'First transaction with this recipient',
                },
            ],
            analyzed_at: Date.now() - 100000,
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should include blockchain proof section when data is provided', async () => {
        const data = createMinimalDossierData(['cover', 'blockchain_proof', 'verification']);
        data.blockchain_anchor = {
            chain: 'polygon',
            chain_name: 'Polygon',
            tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            block_number: 52847293,
            timestamp: Date.now() - 50000,
            merkle_root: '0xmerkleroot123',
            explorer_url: 'https://polygonscan.com/tx/0x1234',
            status: 'confirmed',
            confirmations: 128,
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should handle all sections together', async () => {
        const data = createMinimalDossierData([
            'cover', 'toc', 'evidence_overview', 'recipients',
            'signatures', 'audit_trail', 'risk_assessment',
            'blockchain_proof', 'verification', 'raw_data',
        ]);

        data.signatures = [
            {
                recipient_id: 'recipient-1',
                recipient_identifier: 'test@example.com',
                signature_type: 'EIP191',
                verified: true,
                signed_at: Date.now(),
            },
        ];

        data.audit_trail = {
            events: [
                {
                    timestamp: new Date().toISOString(),
                    event_type: 'CREATED',
                    actor_type: 'INITIATOR',
                    actor: 'user-123',
                    recipient_id: null,
                    details: null,
                },
            ],
            hash: 'audit-hash',
        };

        data.risk_assessment = {
            risk_score: 25,
            risk_level: 'LOW',
            flags: [],
        };

        data.blockchain_anchor = {
            chain: 'polygon',
            chain_name: 'Polygon',
            tx_hash: '0xabc',
            explorer_url: 'https://polygonscan.com/tx/0xabc',
            status: 'confirmed',
        };

        if (data.enf_bundle) {
            data.enf_bundle.evidence_payload = { test: 'data', nested: { value: 123 } };
        }

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should respect custom PDF config', async () => {
        const data = createMinimalDossierData();

        const a4Pdf = await generateDossierPdf(data, { pageSize: 'A4' });
        const letterPdf = await generateDossierPdf(data, { pageSize: 'LETTER' });

        // Both should be valid PDFs
        expect(new TextDecoder().decode(a4Pdf.slice(0, 5))).toBe('%PDF-');
        expect(new TextDecoder().decode(letterPdf.slice(0, 5))).toBe('%PDF-');
    });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
    it('should handle empty recipients array', async () => {
        const data: DossierData = {
            export_id: 'test-123',
            exported_at: new Date().toISOString(),
            exported_by_user_id: 'user-123',
            intent: 'evidence',
            sections: ['cover', 'verification'],
            content_hash: 'abc123',
            recipients: [],
            verification: {
                portal_url: 'https://verify.tattlehash.com',
                qr_code_data: 'https://verify.tattlehash.com?hash=abc',
                document_hash: 'abc123',
                hash_algorithm: 'SHA-256',
            },
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should handle missing optional fields', async () => {
        const data: DossierData = {
            export_id: 'test-123',
            exported_at: new Date().toISOString(),
            exported_by_user_id: 'user-123',
            intent: 'evidence',
            sections: ['verification'],
            content_hash: 'abc123',
            verification: {
                portal_url: 'https://verify.tattlehash.com',
                qr_code_data: 'https://verify.tattlehash.com?hash=abc',
                document_hash: 'abc123',
                hash_algorithm: 'SHA-256',
            },
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should handle very long text content', async () => {
        const longDescription = 'A'.repeat(5000);

        const data: DossierData = {
            export_id: 'test-123',
            exported_at: new Date().toISOString(),
            exported_by_user_id: 'user-123',
            intent: 'evidence',
            sections: ['cover', 'evidence_overview', 'verification'],
            content_hash: 'abc123',
            enf_bundle: {
                id: 'bundle-123',
                title: 'Test Bundle',
                description: longDescription,
                status: 'COMPLETE',
                evidence_hash: 'hash-123',
                initiator_user_id: 'user-123',
                expires_at: Date.now() + 86400000,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
            verification: {
                portal_url: 'https://verify.tattlehash.com',
                qr_code_data: 'https://verify.tattlehash.com?hash=abc',
                document_hash: 'abc123',
                hash_algorithm: 'SHA-256',
            },
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });

    it('should handle special characters in content', async () => {
        const data: DossierData = {
            export_id: 'test-123',
            exported_at: new Date().toISOString(),
            exported_by_user_id: 'user-123',
            intent: 'evidence',
            sections: ['cover', 'evidence_overview', 'verification'],
            content_hash: 'abc123',
            enf_bundle: {
                id: 'bundle-123',
                title: 'Test with "quotes" & <special> characters',
                description: 'Description with unicode: \u00e9\u00e8\u00ea\u00eb',
                status: 'COMPLETE',
                evidence_hash: 'hash-123',
                initiator_user_id: 'user-123',
                expires_at: Date.now() + 86400000,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
            verification: {
                portal_url: 'https://verify.tattlehash.com',
                qr_code_data: 'https://verify.tattlehash.com?hash=abc',
                document_hash: 'abc123',
                hash_algorithm: 'SHA-256',
            },
        };

        const pdfBytes = await generateDossierPdf(data);
        expect(pdfBytes.length).toBeGreaterThan(0);
    });
});
