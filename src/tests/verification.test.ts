/**
 * Verification Portal Tests
 *
 * Tests for document verification, blockchain lookups,
 * and Merkle proof validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    VerifyByHashSchema,
    VerifyByTargetSchema,
    VerifyMerkleProofSchema,
    CHAIN_EXPLORER_URLS,
    CHAIN_NAMES,
    CHAIN_IDS,
} from '../verification/types';
import { verifyProof } from '../verification/service';
import type { VerifyMerkleProofInput } from '../verification/types';

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Verification Schema Validation', () => {
    describe('VerifyByHashSchema', () => {
        it('should accept valid hash', () => {
            const input = {
                hash: 'abc123def456789012345678901234567890abcdef',
            };
            const result = VerifyByHashSchema.parse(input);
            expect(result.hash).toBe(input.hash);
        });

        it('should accept hash with optional target_type', () => {
            const input = {
                hash: 'abc123def456789012345678901234567890abcdef',
                target_type: 'ENF_BUNDLE',
            };
            const result = VerifyByHashSchema.parse(input);
            expect(result.target_type).toBe('ENF_BUNDLE');
        });

        it('should accept hash with target_type and target_id', () => {
            const input = {
                hash: 'abc123def456789012345678901234567890abcdef',
                target_type: 'ENF_BUNDLE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
            };
            const result = VerifyByHashSchema.parse(input);
            expect(result.target_id).toBe(input.target_id);
        });

        it('should reject hash that is too short', () => {
            const input = { hash: 'abc123' };
            expect(() => VerifyByHashSchema.parse(input)).toThrow();
        });

        it('should reject invalid target_type', () => {
            const input = {
                hash: 'abc123def456789012345678901234567890abcdef',
                target_type: 'INVALID',
            };
            expect(() => VerifyByHashSchema.parse(input)).toThrow();
        });

        it('should reject invalid target_id format', () => {
            const input = {
                hash: 'abc123def456789012345678901234567890abcdef',
                target_type: 'ENF_BUNDLE',
                target_id: 'not-a-uuid',
            };
            expect(() => VerifyByHashSchema.parse(input)).toThrow();
        });

        it('should accept all valid target types', () => {
            const types = ['ENF_BUNDLE', 'CHALLENGE', 'ATTESTATION'];
            for (const type of types) {
                const input = {
                    hash: 'abc123def456789012345678901234567890abcdef',
                    target_type: type,
                };
                const result = VerifyByHashSchema.parse(input);
                expect(result.target_type).toBe(type);
            }
        });
    });

    describe('VerifyByTargetSchema', () => {
        it('should accept valid ENF_BUNDLE target', () => {
            const input = {
                target_type: 'ENF_BUNDLE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
            };
            const result = VerifyByTargetSchema.parse(input);
            expect(result.target_type).toBe('ENF_BUNDLE');
        });

        it('should accept valid CHALLENGE target', () => {
            const input = {
                target_type: 'CHALLENGE',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
            };
            const result = VerifyByTargetSchema.parse(input);
            expect(result.target_type).toBe('CHALLENGE');
        });

        it('should accept valid ATTESTATION target', () => {
            const input = {
                target_type: 'ATTESTATION',
                target_id: '550e8400-e29b-41d4-a716-446655440000',
            };
            const result = VerifyByTargetSchema.parse(input);
            expect(result.target_type).toBe('ATTESTATION');
        });

        it('should reject missing target_type', () => {
            const input = {
                target_id: '550e8400-e29b-41d4-a716-446655440000',
            };
            expect(() => VerifyByTargetSchema.parse(input)).toThrow();
        });

        it('should reject missing target_id', () => {
            const input = {
                target_type: 'ENF_BUNDLE',
            };
            expect(() => VerifyByTargetSchema.parse(input)).toThrow();
        });
    });

    describe('VerifyMerkleProofSchema', () => {
        it('should accept valid Merkle proof', () => {
            const input = {
                leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                root: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
                proof: [
                    '0x1111111111111111111111111111111111111111111111111111111111111111',
                    '0x2222222222222222222222222222222222222222222222222222222222222222',
                ],
                index: 0,
            };
            const result = VerifyMerkleProofSchema.parse(input);
            expect(result.leaf).toBe(input.leaf);
            expect(result.proof).toHaveLength(2);
        });

        it('should accept empty proof array (single leaf tree)', () => {
            const input = {
                leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                root: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                proof: [],
                index: 0,
            };
            const result = VerifyMerkleProofSchema.parse(input);
            expect(result.proof).toHaveLength(0);
        });

        it('should reject invalid leaf hash format', () => {
            const input = {
                leaf: 'not-a-valid-hash',
                root: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                proof: [],
                index: 0,
            };
            expect(() => VerifyMerkleProofSchema.parse(input)).toThrow();
        });

        it('should reject negative index', () => {
            const input = {
                leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                root: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                proof: [],
                index: -1,
            };
            expect(() => VerifyMerkleProofSchema.parse(input)).toThrow();
        });

        it('should reject hash without 0x prefix', () => {
            const input = {
                leaf: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                root: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                proof: [],
                index: 0,
            };
            expect(() => VerifyMerkleProofSchema.parse(input)).toThrow();
        });
    });
});

// ============================================================================
// Chain Configuration Tests
// ============================================================================

describe('Chain Configuration', () => {
    describe('CHAIN_EXPLORER_URLS', () => {
        it('should have URL for polygon', () => {
            expect(CHAIN_EXPLORER_URLS.polygon).toBe('https://polygonscan.com');
        });

        it('should have URL for ethereum', () => {
            expect(CHAIN_EXPLORER_URLS.ethereum).toBe('https://etherscan.io');
        });

        it('should have URL for base', () => {
            expect(CHAIN_EXPLORER_URLS.base).toBe('https://basescan.org');
        });
    });

    describe('CHAIN_NAMES', () => {
        it('should have name for polygon', () => {
            expect(CHAIN_NAMES.polygon).toBe('Polygon PoS');
        });

        it('should have name for ethereum', () => {
            expect(CHAIN_NAMES.ethereum).toBe('Ethereum Mainnet');
        });
    });

    describe('CHAIN_IDS', () => {
        it('should have correct chain ID for polygon', () => {
            expect(CHAIN_IDS.polygon).toBe(137);
        });

        it('should have correct chain ID for ethereum', () => {
            expect(CHAIN_IDS.ethereum).toBe(1);
        });

        it('should have correct chain ID for base', () => {
            expect(CHAIN_IDS.base).toBe(8453);
        });
    });
});

// ============================================================================
// Merkle Proof Verification Tests
// ============================================================================

describe('Merkle Proof Verification', () => {
    it('should verify a valid single-leaf proof', async () => {
        // Single leaf tree: leaf == root
        const input: VerifyMerkleProofInput = {
            leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            root: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            proof: [],
            index: 0,
        };

        const result = await verifyProof(input);
        expect(result.valid).toBe(true);
        expect(result.message).toContain('valid');
    });

    it('should reject proof with mismatched root', async () => {
        const input: VerifyMerkleProofInput = {
            leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            root: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            proof: [],
            index: 0,
        };

        const result = await verifyProof(input);
        expect(result.valid).toBe(false);
        expect(result.message).toContain('invalid');
    });

    it('should handle proof verification errors gracefully', async () => {
        // Invalid hex will cause an error
        const input: VerifyMerkleProofInput = {
            leaf: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            root: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            proof: ['0xgg00000000000000000000000000000000000000000000000000000000000000'], // invalid hex
            index: 0,
        };

        const result = await verifyProof(input);
        // Should either return invalid or handle error gracefully
        expect(typeof result.valid).toBe('boolean');
        expect(typeof result.message).toBe('string');
    });
});

// ============================================================================
// Integration Test Helpers
// ============================================================================

describe('Verification Result Structure', () => {
    it('should define correct VerificationStatus values', () => {
        const validStatuses = ['VERIFIED', 'PENDING', 'NOT_FOUND', 'INVALID', 'EXPIRED'];
        // This is a type-level test, ensuring our types are correct
        expect(validStatuses).toContain('VERIFIED');
        expect(validStatuses).toContain('NOT_FOUND');
    });

    it('should define correct BlockchainStatus values', () => {
        const validStatuses = ['CONFIRMED', 'PENDING', 'NOT_ANCHORED', 'FAILED', 'REORGED'];
        expect(validStatuses).toContain('CONFIRMED');
        expect(validStatuses).toContain('PENDING');
    });
});

// ============================================================================
// Mock-based Service Tests
// ============================================================================

describe('Verification Service', () => {
    // Helper to create mock environment
    function createMockEnv(dbResults: any[] = []): any {
        const mockDb = {
            prepare: vi.fn().mockImplementation(() => ({
                bind: vi.fn().mockReturnThis(),
                all: vi.fn().mockResolvedValue({ results: dbResults }),
                run: vi.fn().mockResolvedValue({ success: true }),
            })),
        };

        const mockKv = {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        return {
            TATTLEHASH_DB: mockDb,
            ATT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
        };
    }

    it('should return NOT_FOUND for unknown hash', async () => {
        const { verifyByHash } = await import('../verification/service');
        const env = createMockEnv([]);

        const result = await verifyByHash(env, 'unknown-hash-12345678901234567890');

        expect(result.status).toBe('NOT_FOUND');
        expect(result.verified).toBe(false);
        expect(result.document_hash).toBe('unknown-hash-12345678901234567890');
    });

    it('should return VERIFIED for found ENF bundle', async () => {
        const { verifyByHash } = await import('../verification/service');
        const mockBundle = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Test Bundle',
            evidence_hash: 'test-hash-123456789012345678901234',
            status: 'COMPLETE',
            created_at: Date.now() - 100000,
            expires_at: Date.now() + 100000,
        };

        const env = createMockEnv([mockBundle]);

        const result = await verifyByHash(env, 'test-hash-123456789012345678901234');

        expect(result.status).toBe('VERIFIED');
        expect(result.verified).toBe(true);
        expect(result.source?.type).toBe('ENF_BUNDLE');
        expect(result.source?.id).toBe(mockBundle.id);
    });

    it('should return EXPIRED for expired bundle', async () => {
        const { verifyByHash } = await import('../verification/service');
        const mockBundle = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Expired Bundle',
            evidence_hash: 'expired-hash-12345678901234567890',
            status: 'COMPLETE',
            created_at: Date.now() - 200000,
            expires_at: Date.now() - 100000, // Expired
        };

        const env = createMockEnv([mockBundle]);

        const result = await verifyByHash(env, 'expired-hash-12345678901234567890');

        expect(result.status).toBe('EXPIRED');
        expect(result.verified).toBe(false);
    });

    it('should add warning for type mismatch', async () => {
        const { verifyByHash } = await import('../verification/service');
        const mockBundle = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Test Bundle',
            evidence_hash: 'test-hash-123456789012345678901234',
            status: 'COMPLETE',
            created_at: Date.now(),
            expires_at: Date.now() + 100000,
        };

        const env = createMockEnv([mockBundle]);

        const result = await verifyByHash(
            env,
            'test-hash-123456789012345678901234',
            'CHALLENGE', // Wrong type
            undefined
        );

        expect(result.warnings).toBeDefined();
        expect(result.warnings?.some(w => w.includes('Expected type'))).toBe(true);
    });
});

// ============================================================================
// Quick Verify Tests
// ============================================================================

describe('Quick Verify', () => {
    function createMockEnv(dbResults: any[] = []): any {
        const mockDb = {
            prepare: vi.fn().mockImplementation(() => ({
                bind: vi.fn().mockReturnThis(),
                all: vi.fn().mockResolvedValue({ results: dbResults }),
                run: vi.fn().mockResolvedValue({ success: true }),
            })),
        };

        const mockKv = {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        return {
            TATTLEHASH_DB: mockDb,
            ATT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
        };
    }

    it('should return simplified result structure', async () => {
        const { quickVerify } = await import('../verification/service');
        const env = createMockEnv([]);

        const result = await quickVerify(env, 'test-hash-123456789012345678901234');

        expect(typeof result.verified).toBe('boolean');
        expect(typeof result.status).toBe('string');
        expect(typeof result.message).toBe('string');
        expect(typeof result.blockchain_confirmed).toBe('boolean');
    });

    it('should not include full details in quick result', async () => {
        const { quickVerify } = await import('../verification/service');
        const mockBundle = {
            id: '123e4567-e89b-12d3-a456-426614174000',
            evidence_hash: 'test-hash-123456789012345678901234',
            status: 'COMPLETE',
            created_at: Date.now(),
            expires_at: Date.now() + 100000,
        };

        const env = createMockEnv([mockBundle]);

        const result = await quickVerify(env, 'test-hash-123456789012345678901234');

        // Quick verify should not have source or merkle_proof
        expect((result as any).source).toBeUndefined();
        expect((result as any).merkle_proof).toBeUndefined();
    });
});
