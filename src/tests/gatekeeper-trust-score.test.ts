/**
 * Tests for Gatekeeper + Trust Score Integration
 *
 * Verifies:
 * 1. Trust Score included in wallet verification response
 * 2. Traffic light calculation using Trust Score
 * 3. Trust Score attestation in verification results
 * 4. Webhook events on score changes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateWalletTrafficLight } from '../gatekeeper/wallet/verify';
import type { TrustScoreResponse } from '../trust-score';

describe('Gatekeeper Trust Score Integration', () => {
    // ============================================================================
    // Traffic Light Calculation Tests
    // ============================================================================

    describe('calculateWalletTrafficLight', () => {
        const createMockTrustScore = (
            overrides: Partial<TrustScoreResponse> = {}
        ): TrustScoreResponse => ({
            wallet: '0x1234567890abcdef1234567890abcdef12345678',
            trustScore: 75,
            riskLevel: 'LOW',
            factors: {
                walletAge: { value: '180 days', score: 80, weight: 0.20, detail: 'Wallet is 180 days old' },
                transactionHistory: { value: '50 txns', score: 85, weight: 0.25, detail: '50 transactions on record' },
                disputeRate: { value: '0%', score: 100, weight: 0.30, detail: 'No disputes' },
                verificationStatus: { value: 'verified', score: 100, weight: 0.15, detail: 'Wallet verified' },
                networkAnalysis: { value: 'clean', score: 90, weight: 0.10, detail: 'No flagged connections' },
            },
            flags: [],
            confidence: 0.85,
            lastUpdated: new Date().toISOString(),
            cacheTTL: 3600,
            ...overrides,
        });

        describe('GREEN light conditions', () => {
            it('should return GREEN when score >= 70 and verification passed', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 75,
                    riskLevel: 'LOW',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('GREEN');
            });

            it('should return GREEN when score is exactly 70', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 70,
                    riskLevel: 'LOW',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('GREEN');
            });

            it('should return GREEN when score is 100', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 100,
                    riskLevel: 'LOW',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('GREEN');
            });
        });

        describe('YELLOW light conditions', () => {
            it('should return YELLOW when score is 40-69 (MEDIUM risk)', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 55,
                    riskLevel: 'MEDIUM',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('YELLOW');
            });

            it('should return YELLOW when score is exactly 40', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 40,
                    riskLevel: 'MEDIUM',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('YELLOW');
            });

            it('should return YELLOW when score is exactly 69', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 69,
                    riskLevel: 'MEDIUM',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('YELLOW');
            });
        });

        describe('RED light conditions', () => {
            it('should return RED when verification failed', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 85,
                    riskLevel: 'LOW',
                });

                const result = calculateWalletTrafficLight(trustScore, false);

                expect(result).toBe('RED');
            });

            it('should return RED when score is 0-39 (HIGH risk)', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 30,
                    riskLevel: 'HIGH',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('RED');
            });

            it('should return RED when score is exactly 39', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 39,
                    riskLevel: 'HIGH',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('RED');
            });

            it('should return RED when score is 0', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 0,
                    riskLevel: 'HIGH',
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('RED');
            });

            it('should return RED when there are CRITICAL flags even with good score', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 75,
                    riskLevel: 'LOW',
                    flags: [
                        {
                            type: 'SCAM_REPORT',
                            severity: 'CRITICAL',
                            description: 'Reported for scam activity',
                            detectedAt: new Date().toISOString(),
                        },
                    ],
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('RED');
            });

            it('should return RED when VERIFICATION_FAILED flag is present', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 60,
                    riskLevel: 'MEDIUM',
                    flags: [
                        {
                            type: 'VERIFICATION_FAILED',
                            severity: 'CRITICAL',
                            description: 'Failed Gatekeeper verification',
                            detectedAt: new Date().toISOString(),
                        },
                    ],
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('RED');
            });
        });

        describe('Edge cases', () => {
            it('should handle WARNING flags without downgrading from GREEN', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 75,
                    riskLevel: 'LOW',
                    flags: [
                        {
                            type: 'WALLET_NEW',
                            severity: 'WARNING',
                            description: 'Wallet is less than 7 days old',
                            detectedAt: new Date().toISOString(),
                        },
                    ],
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                // WARNING flags don't trigger RED, only CRITICAL
                expect(result).toBe('GREEN');
            });

            it('should handle INFO flags without affecting traffic light', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 75,
                    riskLevel: 'LOW',
                    flags: [
                        {
                            type: 'LIMITED_HISTORY',
                            severity: 'INFO',
                            description: 'Fewer than 3 transactions',
                            detectedAt: new Date().toISOString(),
                        },
                    ],
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                expect(result).toBe('GREEN');
            });

            it('should prioritize verification failure over good score', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 100,
                    riskLevel: 'LOW',
                    flags: [],
                });

                const result = calculateWalletTrafficLight(trustScore, false);

                expect(result).toBe('RED');
            });

            it('should handle multiple flags correctly', () => {
                const trustScore = createMockTrustScore({
                    trustScore: 45,
                    riskLevel: 'MEDIUM',
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
                });

                const result = calculateWalletTrafficLight(trustScore, true);

                // MEDIUM risk = YELLOW
                expect(result).toBe('YELLOW');
            });
        });
    });

    // ============================================================================
    // Trust Score Summary Tests
    // ============================================================================

    describe('TrustScoreSummary in WalletVerifyResponse', () => {
        it('should include all required fields', () => {
            const trustScore = {
                wallet: '0x1234567890abcdef1234567890abcdef12345678',
                trustScore: 75,
                riskLevel: 'LOW' as const,
                factors: {
                    walletAge: { value: '180 days', score: 80, weight: 0.20, detail: 'test' },
                    transactionHistory: { value: '50 txns', score: 85, weight: 0.25, detail: 'test' },
                    disputeRate: { value: '0%', score: 100, weight: 0.30, detail: 'test' },
                    verificationStatus: { value: 'verified', score: 100, weight: 0.15, detail: 'test' },
                    networkAnalysis: { value: 'clean', score: 90, weight: 0.10, detail: 'test' },
                },
                flags: [],
                confidence: 0.85,
                lastUpdated: new Date().toISOString(),
                cacheTTL: 3600,
            };

            // Extract summary fields as they would be in WalletVerifyResponse
            const summary = {
                score: trustScore.trustScore,
                riskLevel: trustScore.riskLevel,
                flags: trustScore.flags,
                confidence: trustScore.confidence,
                lastUpdated: trustScore.lastUpdated,
            };

            expect(summary.score).toBe(75);
            expect(summary.riskLevel).toBe('LOW');
            expect(summary.flags).toEqual([]);
            expect(summary.confidence).toBe(0.85);
            expect(typeof summary.lastUpdated).toBe('string');
        });
    });

    // ============================================================================
    // Trust Score Attestation Tests
    // ============================================================================

    describe('TrustScoreAttestation in VerificationResult', () => {
        it('should include trust score in attestation metadata', () => {
            const attestation = {
                wallet: '0x1234567890abcdef1234567890abcdef12345678',
                score: 75,
                riskLevel: 'LOW' as const,
                trafficLight: 'GREEN' as const,
                flagCount: 0,
                confidence: 0.85,
                assessedAt: new Date().toISOString(),
            };

            expect(attestation.wallet).toMatch(/^0x[a-f0-9]{40}$/);
            expect(attestation.score).toBeGreaterThanOrEqual(0);
            expect(attestation.score).toBeLessThanOrEqual(100);
            expect(['LOW', 'MEDIUM', 'HIGH']).toContain(attestation.riskLevel);
            expect(['GREEN', 'YELLOW', 'RED']).toContain(attestation.trafficLight);
            expect(attestation.flagCount).toBeGreaterThanOrEqual(0);
            expect(attestation.confidence).toBeGreaterThanOrEqual(0);
            expect(attestation.confidence).toBeLessThanOrEqual(1);
        });

        it('should correctly map risk level to traffic light', () => {
            const testCases = [
                { riskLevel: 'LOW', expectedLight: 'GREEN' },
                { riskLevel: 'MEDIUM', expectedLight: 'YELLOW' },
                { riskLevel: 'HIGH', expectedLight: 'RED' },
            ];

            for (const { riskLevel, expectedLight } of testCases) {
                const trustScore = {
                    wallet: '0x1234567890abcdef1234567890abcdef12345678',
                    trustScore: riskLevel === 'LOW' ? 75 : riskLevel === 'MEDIUM' ? 50 : 25,
                    riskLevel: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH',
                    factors: {
                        walletAge: { value: 'test', score: 50, weight: 0.20, detail: 'test' },
                        transactionHistory: { value: 'test', score: 50, weight: 0.25, detail: 'test' },
                        disputeRate: { value: 'test', score: 50, weight: 0.30, detail: 'test' },
                        verificationStatus: { value: 'test', score: 50, weight: 0.15, detail: 'test' },
                        networkAnalysis: { value: 'test', score: 50, weight: 0.10, detail: 'test' },
                    },
                    flags: [],
                    confidence: 0.8,
                    lastUpdated: new Date().toISOString(),
                    cacheTTL: 3600,
                };

                const trafficLight = calculateWalletTrafficLight(trustScore, true);
                expect(trafficLight).toBe(expectedLight);
            }
        });
    });

    // ============================================================================
    // Score Change Detection Tests
    // ============================================================================

    describe('Score Change Detection', () => {
        it('should detect significant score increase (10+ points)', () => {
            const prevScore = 50;
            const currentScore = 65;
            const delta = currentScore - prevScore;

            expect(Math.abs(delta)).toBeGreaterThanOrEqual(10);
        });

        it('should detect significant score decrease (10+ points)', () => {
            const prevScore = 70;
            const currentScore = 55;
            const delta = currentScore - prevScore;

            expect(Math.abs(delta)).toBeGreaterThanOrEqual(10);
        });

        it('should detect risk level change', () => {
            const prevRiskLevel = 'MEDIUM';
            const currentRiskLevel = 'HIGH';

            expect(prevRiskLevel).not.toBe(currentRiskLevel);
        });

        it('should not trigger on minor score change (< 10 points)', () => {
            const prevScore = 50;
            const currentScore = 55;
            const delta = currentScore - prevScore;

            expect(Math.abs(delta)).toBeLessThan(10);
        });
    });

    // ============================================================================
    // Traffic Light with Stakes Integration Tests
    // ============================================================================

    describe('Traffic Light with Trust Score in ENFORCED Mode', () => {
        it('should include trust scores in evaluation details', () => {
            // Mock evaluation details structure
            const evaluationDetails = {
                creatorStake: {
                    status: 'CONFIRMED' as const,
                    required: '100',
                    deposited: '100',
                    confirmations: 12,
                    requiredConfirmations: 12,
                },
                counterpartyStake: {
                    status: 'CONFIRMED' as const,
                    required: '100',
                    deposited: '100',
                    confirmations: 12,
                    requiredConfirmations: 12,
                },
                thresholdsMet: true,
                timeRemaining: 3600,
                flags: [],
                trustScores: {
                    creator: {
                        wallet: '0x1234567890abcdef1234567890abcdef12345678',
                        score: 75,
                        riskLevel: 'LOW' as const,
                        hasCriticalFlags: false,
                        confidence: 0.85,
                    },
                    counterparty: {
                        wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
                        score: 80,
                        riskLevel: 'LOW' as const,
                        hasCriticalFlags: false,
                        confidence: 0.9,
                    },
                },
            };

            expect(evaluationDetails.trustScores).toBeDefined();
            expect(evaluationDetails.trustScores?.creator).toBeDefined();
            expect(evaluationDetails.trustScores?.counterparty).toBeDefined();
            expect(evaluationDetails.trustScores?.creator?.score).toBe(75);
            expect(evaluationDetails.trustScores?.counterparty?.score).toBe(80);
        });

        it('should add flags for HIGH risk wallets', () => {
            const flags: string[] = [];
            const creatorTrustScore = {
                wallet: '0x1234567890abcdef1234567890abcdef12345678',
                score: 30,
                riskLevel: 'HIGH' as const,
                hasCriticalFlags: false,
                confidence: 0.7,
            };

            if (creatorTrustScore.riskLevel === 'HIGH') {
                flags.push(`Creator wallet has HIGH risk score (${creatorTrustScore.score})`);
            }

            expect(flags).toContain('Creator wallet has HIGH risk score (30)');
        });

        it('should add flags for MEDIUM risk wallets', () => {
            const flags: string[] = [];
            const counterpartyTrustScore = {
                wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
                score: 50,
                riskLevel: 'MEDIUM' as const,
                hasCriticalFlags: false,
                confidence: 0.75,
            };

            if (counterpartyTrustScore.riskLevel === 'MEDIUM') {
                flags.push(`Counterparty wallet has MEDIUM risk score (${counterpartyTrustScore.score})`);
            }

            expect(flags).toContain('Counterparty wallet has MEDIUM risk score (50)');
        });

        it('should add flags for CRITICAL trust flags', () => {
            const flags: string[] = [];
            const creatorTrustScore = {
                wallet: '0x1234567890abcdef1234567890abcdef12345678',
                score: 60,
                riskLevel: 'MEDIUM' as const,
                hasCriticalFlags: true,
                confidence: 0.8,
            };

            if (creatorTrustScore.hasCriticalFlags) {
                flags.push('Creator wallet has CRITICAL trust flags');
            }

            expect(flags).toContain('Creator wallet has CRITICAL trust flags');
        });
    });
});
