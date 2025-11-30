/**
 * Trust Score Tests
 *
 * Tests for wallet trust score calculation and API endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    normalizeWallet,
    getRiskLevel,
    getCacheKey,
    RISK_THRESHOLDS,
    FACTOR_WEIGHTS,
    FLAG_DEFINITIONS,
    TRUST_SCORE_DEFAULTS,
    WalletAddressSchema,
    RiskLevelSchema,
    FlagTypeSchema,
    TrustScoreResponseSchema,
    BatchTrustScoreRequestSchema,
} from '../trust-score';
import type { Env } from '../types';

// Test wallet addresses
const TEST_WALLET_1 = '0x1234567890abcdef1234567890abcdef12345678';
const TEST_WALLET_2 = '0xabcdef1234567890abcdef1234567890abcdef12';
const TEST_WALLET_3 = '0x9876543210fedcba9876543210fedcba98765432';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(): Env {
    const dbResults: Record<string, any[]> = {};
    const kvStore: Record<string, string> = {};

    const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => ({
            bind: vi.fn().mockImplementation((...args: any[]) => ({
                all: vi.fn().mockResolvedValue({ results: dbResults[sql] || [] }),
                first: vi.fn().mockResolvedValue(null),
                run: vi.fn().mockResolvedValue({ success: true }),
            })),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(null),
            run: vi.fn().mockResolvedValue({ success: true }),
        })),
        exec: vi.fn().mockResolvedValue({ success: true }),
    };

    const mockKv = {
        put: vi.fn().mockImplementation(async (key: string, value: string) => {
            kvStore[key] = value;
        }),
        get: vi.fn().mockImplementation(async (key: string) => {
            return kvStore[key] || null;
        }),
        delete: vi.fn().mockImplementation(async (key: string) => {
            delete kvStore[key];
        }),
    };

    const mockQueue = {
        send: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        TATTLEHASH_KV: mockKv,
        TATTLEHASH_CONTENT_KV: mockKv,
        TATTLEHASH_ANCHOR_KV: mockKv,
        TATTLEHASH_ERROR_KV: mockKv,
        ATT_KV: mockKv,
        GATE_KV: mockKv,
        SHIELD_KV: mockKv,
        TATTLEHASH_QUEUE: mockQueue,
    } as any;
}

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('Trust Score Helpers', () => {
    describe('normalizeWallet', () => {
        it('should lowercase wallet address', () => {
            expect(normalizeWallet('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(
                '0xabcdef1234567890abcdef1234567890abcdef12'
            );
        });

        it('should handle already lowercase address', () => {
            expect(normalizeWallet(TEST_WALLET_1)).toBe(TEST_WALLET_1.toLowerCase());
        });

        it('should handle mixed case address', () => {
            const mixed = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
            expect(normalizeWallet(mixed)).toBe(mixed.toLowerCase());
        });
    });

    describe('getRiskLevel', () => {
        it('should return LOW for scores 70-100', () => {
            expect(getRiskLevel(70)).toBe('LOW');
            expect(getRiskLevel(85)).toBe('LOW');
            expect(getRiskLevel(100)).toBe('LOW');
        });

        it('should return MEDIUM for scores 40-69', () => {
            expect(getRiskLevel(40)).toBe('MEDIUM');
            expect(getRiskLevel(55)).toBe('MEDIUM');
            expect(getRiskLevel(69)).toBe('MEDIUM');
        });

        it('should return HIGH for scores 0-39', () => {
            expect(getRiskLevel(0)).toBe('HIGH');
            expect(getRiskLevel(20)).toBe('HIGH');
            expect(getRiskLevel(39)).toBe('HIGH');
        });

        it('should handle boundary values correctly', () => {
            expect(getRiskLevel(70)).toBe('LOW');  // Boundary LOW
            expect(getRiskLevel(69)).toBe('MEDIUM'); // Just below LOW
            expect(getRiskLevel(40)).toBe('MEDIUM'); // Boundary MEDIUM
            expect(getRiskLevel(39)).toBe('HIGH');  // Just below MEDIUM
        });
    });

    describe('getCacheKey', () => {
        it('should generate correct cache key', () => {
            expect(getCacheKey(TEST_WALLET_1)).toBe(`trust_score:${TEST_WALLET_1.toLowerCase()}`);
        });

        it('should normalize wallet in cache key', () => {
            const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
            expect(getCacheKey(upper)).toBe(`trust_score:${upper.toLowerCase()}`);
        });

        it('should produce consistent keys for same wallet', () => {
            const key1 = getCacheKey(TEST_WALLET_1);
            const key2 = getCacheKey(TEST_WALLET_1.toUpperCase());
            expect(key1).toBe(key2);
        });
    });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('Trust Score Constants', () => {
    describe('RISK_THRESHOLDS', () => {
        it('should have correct threshold values', () => {
            expect(RISK_THRESHOLDS.LOW_MIN).toBe(70);
            expect(RISK_THRESHOLDS.MEDIUM_MIN).toBe(40);
        });

        it('should have non-overlapping ranges', () => {
            // LOW: 70-100, MEDIUM: 40-69, HIGH: 0-39
            expect(RISK_THRESHOLDS.LOW_MIN).toBeGreaterThan(RISK_THRESHOLDS.MEDIUM_MIN);
        });
    });

    describe('FACTOR_WEIGHTS', () => {
        it('should sum to 1.0', () => {
            const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 5);
        });

        it('should have correct individual weights', () => {
            expect(FACTOR_WEIGHTS.walletAge).toBe(0.20);
            expect(FACTOR_WEIGHTS.transactionHistory).toBe(0.25);
            expect(FACTOR_WEIGHTS.disputeRate).toBe(0.30);
            expect(FACTOR_WEIGHTS.verificationStatus).toBe(0.15);
            expect(FACTOR_WEIGHTS.networkAnalysis).toBe(0.10);
        });

        it('should have dispute rate as highest weight', () => {
            const maxWeight = Math.max(...Object.values(FACTOR_WEIGHTS));
            expect(FACTOR_WEIGHTS.disputeRate).toBe(maxWeight);
        });

        it('should have network analysis as lowest weight', () => {
            const minWeight = Math.min(...Object.values(FACTOR_WEIGHTS));
            expect(FACTOR_WEIGHTS.networkAnalysis).toBe(minWeight);
        });
    });

    describe('FLAG_DEFINITIONS', () => {
        it('should have all flag types defined', () => {
            expect(FLAG_DEFINITIONS.WALLET_NEW).toBeDefined();
            expect(FLAG_DEFINITIONS.LIMITED_HISTORY).toBeDefined();
            expect(FLAG_DEFINITIONS.DISPUTE_HISTORY).toBeDefined();
            expect(FLAG_DEFINITIONS.VERIFICATION_FAILED).toBeDefined();
            expect(FLAG_DEFINITIONS.FLAGGED_CONNECTIONS).toBeDefined();
            expect(FLAG_DEFINITIONS.PATTERN_ANOMALY).toBeDefined();
            expect(FLAG_DEFINITIONS.SCAM_REPORT).toBeDefined();
            expect(FLAG_DEFINITIONS.MANUAL_FLAG).toBeDefined();
        });

        it('should have severity and score impact for each flag', () => {
            for (const [key, def] of Object.entries(FLAG_DEFINITIONS)) {
                expect(def.severity).toBeDefined();
                expect(['INFO', 'WARNING', 'CRITICAL']).toContain(def.severity);
                expect(def.description).toBeDefined();
                expect(def.scoreImpact).toBeDefined();
                expect(def.scoreImpact).toBeLessThanOrEqual(0);
            }
        });

        it('should have SCAM_REPORT as most severe impact', () => {
            const maxImpact = Math.min(...Object.values(FLAG_DEFINITIONS).map(f => f.scoreImpact));
            expect(FLAG_DEFINITIONS.SCAM_REPORT.scoreImpact).toBe(maxImpact);
        });

        it('should have VERIFICATION_FAILED as CRITICAL severity', () => {
            expect(FLAG_DEFINITIONS.VERIFICATION_FAILED.severity).toBe('CRITICAL');
        });
    });

    describe('TRUST_SCORE_DEFAULTS', () => {
        it('should have correct default values', () => {
            expect(TRUST_SCORE_DEFAULTS.CACHE_TTL_SECONDS).toBe(3600);
            expect(TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE).toBe(100);
            expect(TRUST_SCORE_DEFAULTS.HISTORY_LIMIT).toBe(100);
        });

        it('should have reasonable cache TTL (1 hour)', () => {
            expect(TRUST_SCORE_DEFAULTS.CACHE_TTL_SECONDS).toBe(60 * 60);
        });
    });
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Trust Score Schema Validation', () => {
    describe('WalletAddressSchema', () => {
        it('should accept valid Ethereum address', () => {
            const result = WalletAddressSchema.safeParse(TEST_WALLET_1);
            expect(result.success).toBe(true);
        });

        it('should accept uppercase hex characters', () => {
            // Note: 0x prefix must be lowercase, but hex characters can be upper/lowercase
            const upperHex = '0x1234567890ABCDEF1234567890ABCDEF12345678';
            const result = WalletAddressSchema.safeParse(upperHex);
            expect(result.success).toBe(true);
        });

        it('should reject uppercase 0X prefix', () => {
            // Ethereum convention uses lowercase 0x
            const result = WalletAddressSchema.safeParse('0X1234567890abcdef1234567890abcdef12345678');
            expect(result.success).toBe(false);
        });

        it('should reject address without 0x prefix', () => {
            const result = WalletAddressSchema.safeParse('1234567890abcdef1234567890abcdef12345678');
            expect(result.success).toBe(false);
        });

        it('should reject short address', () => {
            const result = WalletAddressSchema.safeParse('0x1234567890abcdef');
            expect(result.success).toBe(false);
        });

        it('should reject long address', () => {
            const result = WalletAddressSchema.safeParse('0x1234567890abcdef1234567890abcdef1234567890');
            expect(result.success).toBe(false);
        });

        it('should reject address with invalid characters', () => {
            const result = WalletAddressSchema.safeParse('0x1234567890abcdef1234567890abcdef1234567g');
            expect(result.success).toBe(false);
        });
    });

    describe('RiskLevelSchema', () => {
        it('should accept valid risk levels', () => {
            expect(RiskLevelSchema.safeParse('LOW').success).toBe(true);
            expect(RiskLevelSchema.safeParse('MEDIUM').success).toBe(true);
            expect(RiskLevelSchema.safeParse('HIGH').success).toBe(true);
        });

        it('should reject invalid risk levels', () => {
            expect(RiskLevelSchema.safeParse('CRITICAL').success).toBe(false);
            expect(RiskLevelSchema.safeParse('low').success).toBe(false);
            expect(RiskLevelSchema.safeParse('').success).toBe(false);
        });
    });

    describe('FlagTypeSchema', () => {
        it('should accept all valid flag types', () => {
            const validFlags = [
                'WALLET_NEW',
                'LIMITED_HISTORY',
                'DISPUTE_HISTORY',
                'VERIFICATION_FAILED',
                'FLAGGED_CONNECTIONS',
                'PATTERN_ANOMALY',
                'SCAM_REPORT',
                'MANUAL_FLAG',
            ];

            for (const flag of validFlags) {
                const result = FlagTypeSchema.safeParse(flag);
                expect(result.success).toBe(true);
            }
        });

        it('should reject invalid flag types', () => {
            expect(FlagTypeSchema.safeParse('INVALID_FLAG').success).toBe(false);
            expect(FlagTypeSchema.safeParse('wallet_new').success).toBe(false);
        });
    });

    describe('BatchTrustScoreRequestSchema', () => {
        it('should accept valid batch request', () => {
            const input = {
                wallets: [TEST_WALLET_1, TEST_WALLET_2],
            };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it('should accept with skipCache option', () => {
            const input = {
                wallets: [TEST_WALLET_1],
                skipCache: true,
            };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.skipCache).toBe(true);
            }
        });

        it('should default skipCache to false', () => {
            const input = {
                wallets: [TEST_WALLET_1],
            };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.skipCache).toBe(false);
            }
        });

        it('should reject empty wallets array', () => {
            const input = { wallets: [] };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject more than MAX_BATCH_SIZE wallets', () => {
            const wallets = Array(TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE + 1)
                .fill(null)
                .map((_, i) => `0x${'0'.repeat(39)}${i.toString(16).padStart(1, '0')}`);

            // Generate valid looking addresses
            const validWallets = Array(TRUST_SCORE_DEFAULTS.MAX_BATCH_SIZE + 1)
                .fill(TEST_WALLET_1);

            const input = { wallets: validWallets };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it('should reject invalid wallet addresses in array', () => {
            const input = {
                wallets: [TEST_WALLET_1, 'invalid-wallet'],
            };
            const result = BatchTrustScoreRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });
    });

    describe('TrustScoreResponseSchema', () => {
        it('should accept valid response', () => {
            const response = {
                wallet: TEST_WALLET_1,
                trustScore: 75,
                riskLevel: 'LOW',
                factors: {
                    walletAge: { value: '30 days', score: 75, weight: 0.20, detail: 'Established wallet' },
                    transactionHistory: { value: '10 transactions', score: 70, weight: 0.25, detail: 'Moderate history' },
                    disputeRate: { value: '0%', score: 100, weight: 0.30, detail: 'No disputes' },
                    verificationStatus: { value: 'Gatekeeper verified', score: 90, weight: 0.15, detail: 'Verified' },
                    networkAnalysis: { value: 'No flagged connections', score: 80, weight: 0.10, detail: 'Clean network' },
                },
                flags: [],
                confidence: 0.85,
                lastUpdated: new Date().toISOString(),
                cacheTTL: 3600,
            };

            const result = TrustScoreResponseSchema.safeParse(response);
            expect(result.success).toBe(true);
        });

        it('should accept response with flags', () => {
            const response = {
                wallet: TEST_WALLET_1,
                trustScore: 45,
                riskLevel: 'MEDIUM',
                factors: {
                    walletAge: { value: '5 days', score: 40, weight: 0.20, detail: 'New wallet' },
                    transactionHistory: { value: '2 transactions', score: 50, weight: 0.25, detail: 'Limited' },
                    disputeRate: { value: '0%', score: 100, weight: 0.30, detail: 'No disputes' },
                    verificationStatus: { value: 'Not verified', score: 50, weight: 0.15, detail: 'Unverified' },
                    networkAnalysis: { value: 'No connections', score: 50, weight: 0.10, detail: 'No network' },
                },
                flags: [
                    {
                        type: 'WALLET_NEW',
                        severity: 'WARNING',
                        description: 'Wallet is less than 7 days old',
                        detectedAt: new Date().toISOString(),
                    },
                    {
                        type: 'LIMITED_HISTORY',
                        severity: 'INFO',
                        description: 'Fewer than 3 transactions',
                        detectedAt: new Date().toISOString(),
                    },
                ],
                confidence: 0.6,
                lastUpdated: new Date().toISOString(),
                cacheTTL: 3600,
            };

            const result = TrustScoreResponseSchema.safeParse(response);
            expect(result.success).toBe(true);
        });

        it('should reject invalid trust score', () => {
            const response = {
                wallet: TEST_WALLET_1,
                trustScore: 150, // Invalid - exceeds 100
                riskLevel: 'LOW',
                factors: {
                    walletAge: { value: '30 days', score: 75, weight: 0.20, detail: 'Test' },
                    transactionHistory: { value: '10', score: 70, weight: 0.25, detail: 'Test' },
                    disputeRate: { value: '0%', score: 100, weight: 0.30, detail: 'Test' },
                    verificationStatus: { value: 'Yes', score: 90, weight: 0.15, detail: 'Test' },
                    networkAnalysis: { value: 'Clean', score: 80, weight: 0.10, detail: 'Test' },
                },
                flags: [],
                confidence: 0.85,
                lastUpdated: new Date().toISOString(),
                cacheTTL: 3600,
            };

            const result = TrustScoreResponseSchema.safeParse(response);
            expect(result.success).toBe(false);
        });

        it('should reject negative trust score', () => {
            const response = {
                wallet: TEST_WALLET_1,
                trustScore: -10,
                riskLevel: 'HIGH',
                factors: {
                    walletAge: { value: '0', score: 0, weight: 0.20, detail: 'Test' },
                    transactionHistory: { value: '0', score: 0, weight: 0.25, detail: 'Test' },
                    disputeRate: { value: '100%', score: 0, weight: 0.30, detail: 'Test' },
                    verificationStatus: { value: 'Failed', score: 0, weight: 0.15, detail: 'Test' },
                    networkAnalysis: { value: 'Bad', score: 0, weight: 0.10, detail: 'Test' },
                },
                flags: [],
                confidence: 0.85,
                lastUpdated: new Date().toISOString(),
                cacheTTL: 3600,
            };

            const result = TrustScoreResponseSchema.safeParse(response);
            expect(result.success).toBe(false);
        });
    });
});

// ============================================================================
// Risk Level Mapping Tests
// ============================================================================

describe('Risk Level Mapping', () => {
    it('should map to traffic light colors correctly', () => {
        // GREEN: LOW risk (70-100)
        expect(getRiskLevel(70)).toBe('LOW');
        expect(getRiskLevel(100)).toBe('LOW');

        // YELLOW: MEDIUM risk (40-69)
        expect(getRiskLevel(40)).toBe('MEDIUM');
        expect(getRiskLevel(69)).toBe('MEDIUM');

        // RED: HIGH risk (0-39)
        expect(getRiskLevel(0)).toBe('HIGH');
        expect(getRiskLevel(39)).toBe('HIGH');
    });

    it('should handle all integer scores 0-100', () => {
        for (let score = 0; score <= 100; score++) {
            const level = getRiskLevel(score);
            expect(['LOW', 'MEDIUM', 'HIGH']).toContain(level);

            if (score >= 70) expect(level).toBe('LOW');
            else if (score >= 40) expect(level).toBe('MEDIUM');
            else expect(level).toBe('HIGH');
        }
    });

    it('should be consistent across calls', () => {
        for (let i = 0; i < 10; i++) {
            expect(getRiskLevel(50)).toBe('MEDIUM');
            expect(getRiskLevel(75)).toBe('LOW');
            expect(getRiskLevel(25)).toBe('HIGH');
        }
    });
});

// ============================================================================
// Traffic Light Display Tests
// ============================================================================

describe('Traffic Light Display Mapping', () => {
    it('should map LOW to GREEN indicator', () => {
        // LOW risk = safe to proceed = GREEN light
        expect(getRiskLevel(70)).toBe('LOW');
        expect(getRiskLevel(80)).toBe('LOW');
        expect(getRiskLevel(90)).toBe('LOW');
        expect(getRiskLevel(100)).toBe('LOW');
    });

    it('should map MEDIUM to YELLOW indicator', () => {
        // MEDIUM risk = caution = YELLOW light
        expect(getRiskLevel(40)).toBe('MEDIUM');
        expect(getRiskLevel(50)).toBe('MEDIUM');
        expect(getRiskLevel(60)).toBe('MEDIUM');
    });

    it('should map HIGH to RED indicator', () => {
        // HIGH risk = do not proceed = RED light
        expect(getRiskLevel(0)).toBe('HIGH');
        expect(getRiskLevel(10)).toBe('HIGH');
        expect(getRiskLevel(20)).toBe('HIGH');
        expect(getRiskLevel(30)).toBe('HIGH');
    });
});

// ============================================================================
// Score Calculation Logic Tests
// ============================================================================

describe('Score Calculation Logic', () => {
    it('should calculate weighted average correctly', () => {
        // Test that weights produce expected scores
        const factors = {
            walletAge: 100,        // weight 0.20 -> 20 points
            transactionHistory: 100, // weight 0.25 -> 25 points
            disputeRate: 100,      // weight 0.30 -> 30 points
            verificationStatus: 100, // weight 0.15 -> 15 points
            networkAnalysis: 100,  // weight 0.10 -> 10 points
        };

        const expectedScore =
            factors.walletAge * FACTOR_WEIGHTS.walletAge +
            factors.transactionHistory * FACTOR_WEIGHTS.transactionHistory +
            factors.disputeRate * FACTOR_WEIGHTS.disputeRate +
            factors.verificationStatus * FACTOR_WEIGHTS.verificationStatus +
            factors.networkAnalysis * FACTOR_WEIGHTS.networkAnalysis;

        expect(expectedScore).toBe(100);
    });

    it('should handle zero scores correctly', () => {
        const factors = {
            walletAge: 0,
            transactionHistory: 0,
            disputeRate: 0,
            verificationStatus: 0,
            networkAnalysis: 0,
        };

        const expectedScore =
            factors.walletAge * FACTOR_WEIGHTS.walletAge +
            factors.transactionHistory * FACTOR_WEIGHTS.transactionHistory +
            factors.disputeRate * FACTOR_WEIGHTS.disputeRate +
            factors.verificationStatus * FACTOR_WEIGHTS.verificationStatus +
            factors.networkAnalysis * FACTOR_WEIGHTS.networkAnalysis;

        expect(expectedScore).toBe(0);
    });

    it('should handle mixed factor scores', () => {
        const factors = {
            walletAge: 50,        // 50 * 0.20 = 10
            transactionHistory: 80, // 80 * 0.25 = 20
            disputeRate: 100,     // 100 * 0.30 = 30
            verificationStatus: 60, // 60 * 0.15 = 9
            networkAnalysis: 70,  // 70 * 0.10 = 7
        };

        const expectedScore =
            factors.walletAge * FACTOR_WEIGHTS.walletAge +
            factors.transactionHistory * FACTOR_WEIGHTS.transactionHistory +
            factors.disputeRate * FACTOR_WEIGHTS.disputeRate +
            factors.verificationStatus * FACTOR_WEIGHTS.verificationStatus +
            factors.networkAnalysis * FACTOR_WEIGHTS.networkAnalysis;

        expect(expectedScore).toBe(76); // 10 + 20 + 30 + 9 + 7 = 76
    });

    it('should give dispute rate highest influence', () => {
        // If only dispute rate is bad, score should drop significantly
        const goodDispute = 100 * FACTOR_WEIGHTS.disputeRate;
        const badDispute = 0 * FACTOR_WEIGHTS.disputeRate;

        const difference = goodDispute - badDispute;
        expect(difference).toBe(30); // 30% of total score
    });
});

// ============================================================================
// Flag Impact Tests
// ============================================================================

describe('Flag Impact', () => {
    it('should have negative score impact for all flags', () => {
        for (const [flagType, definition] of Object.entries(FLAG_DEFINITIONS)) {
            expect(definition.scoreImpact).toBeLessThanOrEqual(0);
        }
    });

    it('should have CRITICAL flags with highest impact', () => {
        const criticalFlags = Object.entries(FLAG_DEFINITIONS)
            .filter(([_, def]) => def.severity === 'CRITICAL');

        for (const [flagType, def] of criticalFlags) {
            // CRITICAL should have at least -20 impact
            expect(def.scoreImpact).toBeLessThanOrEqual(-20);
        }
    });

    it('should have INFO flags with lowest impact', () => {
        const infoFlags = Object.entries(FLAG_DEFINITIONS)
            .filter(([_, def]) => def.severity === 'INFO');

        for (const [flagType, def] of infoFlags) {
            // INFO should have minimal impact
            expect(def.scoreImpact).toBeGreaterThanOrEqual(-10);
        }
    });

    it('should rank SCAM_REPORT as most severe', () => {
        const impacts = Object.values(FLAG_DEFINITIONS).map(f => f.scoreImpact);
        const minImpact = Math.min(...impacts);

        expect(FLAG_DEFINITIONS.SCAM_REPORT.scoreImpact).toBe(minImpact);
        expect(FLAG_DEFINITIONS.SCAM_REPORT.severity).toBe('CRITICAL');
    });
});
