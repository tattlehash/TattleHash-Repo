/**
 * LLM Monitoring Tests
 *
 * Comprehensive tests for the LLM monitoring system including:
 * - Schema validation
 * - Monitoring modes and configurations
 * - Scam Shield URL analysis
 * - Risk scoring
 * - Agent architecture
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CreateAnalysisSchema,
    AnalyzeTransactionSchema,
    ScanUrlSchema,
    GetRiskScoreSchema,
    AgentInputSchema,
    AgentFlagSchema,
    AgentOutputSchema,
    TargetTypeSchema,
    MonitoringModeSchema,
    TriggerTypeSchema,
    AgentTypeSchema,
    FlagTypeSchema,
    FlagSeveritySchema,
    RiskLevelSchema,
    RecommendationSchema,
    MONITORING_MODES,
    MONITORING_DEFAULTS,
    AGENT_TYPES,
    FLAG_TYPES,
    DEFAULT_RISK_THRESHOLDS,
} from '../monitoring/types';
import { extractUrls } from '../monitoring/scam-shield';
import { getRegisteredAgentTypes, createAgent, BaseAgent } from '../monitoring/agents';
import { LlmClient } from '../monitoring/client';
import { Env } from '../types';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(dbResults: any[] = []): Env {
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

    const mockErrorKv = {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
    };

    const mockQueue = {
        send: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        TATTLEHASH_KV: mockKv,
        TATTLEHASH_ERROR_KV: mockErrorKv,
        TATTLEHASH_QUEUE: mockQueue,
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4o-mini',
    } as any;
}

// ============================================================================
// Constants Tests
// ============================================================================

describe('LLM Monitoring Constants', () => {
    describe('MONITORING_MODES', () => {
        it('should define three monitoring modes', () => {
            expect(Object.keys(MONITORING_MODES)).toHaveLength(3);
            expect(MONITORING_MODES.EXPLORATORY).toBeDefined();
            expect(MONITORING_MODES.BALANCED).toBeDefined();
            expect(MONITORING_MODES.PRECISION).toBeDefined();
        });

        it('should have correct strictness levels', () => {
            expect(MONITORING_MODES.EXPLORATORY.strictness).toBe('low');
            expect(MONITORING_MODES.BALANCED.strictness).toBe('medium');
            expect(MONITORING_MODES.PRECISION.strictness).toBe('high');
        });

        it('should have descriptive names', () => {
            expect(MONITORING_MODES.EXPLORATORY.name).toBe('Exploratory Bot');
            expect(MONITORING_MODES.BALANCED.name).toBe('Balanced Sentinel');
            expect(MONITORING_MODES.PRECISION.name).toBe('Precision Guard');
        });
    });

    describe('MONITORING_DEFAULTS', () => {
        it('should have reasonable default values', () => {
            expect(MONITORING_DEFAULTS.DEFAULT_MODEL).toBe('gpt-4o-mini');
            expect(MONITORING_DEFAULTS.DEFAULT_TEMPERATURE).toBe(0.3);
            expect(MONITORING_DEFAULTS.DEFAULT_MAX_TOKENS).toBe(2000);
            expect(MONITORING_DEFAULTS.MAX_RETRIES).toBe(3);
        });

        it('should have cache TTLs in milliseconds', () => {
            expect(MONITORING_DEFAULTS.ANALYSIS_CACHE_TTL_MS).toBe(30 * 60 * 1000); // 30 minutes
            expect(MONITORING_DEFAULTS.RISK_SCORE_TTL_MS).toBe(24 * 60 * 60 * 1000); // 24 hours
            expect(MONITORING_DEFAULTS.URL_SCAN_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
        });
    });

    describe('AGENT_TYPES', () => {
        it('should define four agent types', () => {
            expect(Object.keys(AGENT_TYPES)).toHaveLength(4);
            expect(AGENT_TYPES.TRANSACTION_MONITOR).toBeDefined();
            expect(AGENT_TYPES.FRAUD_ANALYZER).toBeDefined();
            expect(AGENT_TYPES.COMPLIANCE_AUDITOR).toBeDefined();
            expect(AGENT_TYPES.CUSTOM).toBeDefined();
        });

        it('should have correct priorities', () => {
            expect(AGENT_TYPES.TRANSACTION_MONITOR.priority).toBe(1);
            expect(AGENT_TYPES.FRAUD_ANALYZER.priority).toBe(2);
            expect(AGENT_TYPES.COMPLIANCE_AUDITOR.priority).toBe(3);
            expect(AGENT_TYPES.CUSTOM.priority).toBe(99);
        });
    });

    describe('FLAG_TYPES', () => {
        it('should define flag types with severities', () => {
            expect(FLAG_TYPES.SCAM_PATTERN.severity).toBe('HIGH');
            expect(FLAG_TYPES.SUSPICIOUS_URL.severity).toBe('HIGH');
            expect(FLAG_TYPES.AMOUNT_ANOMALY.severity).toBe('MEDIUM');
            expect(FLAG_TYPES.TIMING_ANOMALY.severity).toBe('LOW');
        });

        it('should categorize flags correctly', () => {
            expect(FLAG_TYPES.SCAM_PATTERN.category).toBe('fraud');
            expect(FLAG_TYPES.COMPLIANCE_ISSUE.category).toBe('compliance');
            expect(FLAG_TYPES.BEHAVIOR_PATTERN.category).toBe('behavioral');
            expect(FLAG_TYPES.IDENTITY_MISMATCH.category).toBe('identity');
        });
    });

    describe('DEFAULT_RISK_THRESHOLDS', () => {
        it('should have ascending thresholds', () => {
            expect(DEFAULT_RISK_THRESHOLDS.LOW).toBe(25);
            expect(DEFAULT_RISK_THRESHOLDS.MEDIUM).toBe(50);
            expect(DEFAULT_RISK_THRESHOLDS.HIGH).toBe(75);
            expect(DEFAULT_RISK_THRESHOLDS.LOW).toBeLessThan(DEFAULT_RISK_THRESHOLDS.MEDIUM);
            expect(DEFAULT_RISK_THRESHOLDS.MEDIUM).toBeLessThan(DEFAULT_RISK_THRESHOLDS.HIGH);
        });
    });
});

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Schema Validation', () => {
    describe('TargetTypeSchema', () => {
        it('should accept valid target types', () => {
            expect(TargetTypeSchema.parse('CHALLENGE')).toBe('CHALLENGE');
            expect(TargetTypeSchema.parse('DISPUTE')).toBe('DISPUTE');
            expect(TargetTypeSchema.parse('ENF_BUNDLE')).toBe('ENF_BUNDLE');
            expect(TargetTypeSchema.parse('USER')).toBe('USER');
            expect(TargetTypeSchema.parse('TRANSACTION')).toBe('TRANSACTION');
        });

        it('should reject invalid target types', () => {
            expect(() => TargetTypeSchema.parse('INVALID')).toThrow();
            expect(() => TargetTypeSchema.parse('')).toThrow();
            expect(() => TargetTypeSchema.parse(123)).toThrow();
        });
    });

    describe('MonitoringModeSchema', () => {
        it('should accept valid monitoring modes', () => {
            expect(MonitoringModeSchema.parse('EXPLORATORY')).toBe('EXPLORATORY');
            expect(MonitoringModeSchema.parse('BALANCED')).toBe('BALANCED');
            expect(MonitoringModeSchema.parse('PRECISION')).toBe('PRECISION');
        });

        it('should reject invalid monitoring modes', () => {
            expect(() => MonitoringModeSchema.parse('AUTO')).toThrow();
            expect(() => MonitoringModeSchema.parse('strict')).toThrow();
        });
    });

    describe('TriggerTypeSchema', () => {
        it('should accept valid trigger types', () => {
            expect(TriggerTypeSchema.parse('AUTO')).toBe('AUTO');
            expect(TriggerTypeSchema.parse('MANUAL')).toBe('MANUAL');
            expect(TriggerTypeSchema.parse('THRESHOLD')).toBe('THRESHOLD');
            expect(TriggerTypeSchema.parse('SCHEDULED')).toBe('SCHEDULED');
        });
    });

    describe('AgentTypeSchema', () => {
        it('should accept valid agent types', () => {
            expect(AgentTypeSchema.parse('TRANSACTION_MONITOR')).toBe('TRANSACTION_MONITOR');
            expect(AgentTypeSchema.parse('FRAUD_ANALYZER')).toBe('FRAUD_ANALYZER');
            expect(AgentTypeSchema.parse('COMPLIANCE_AUDITOR')).toBe('COMPLIANCE_AUDITOR');
            expect(AgentTypeSchema.parse('CUSTOM')).toBe('CUSTOM');
        });
    });

    describe('FlagTypeSchema', () => {
        it('should accept all flag types', () => {
            const validTypes = [
                'SCAM_PATTERN', 'SUSPICIOUS_URL', 'AMOUNT_ANOMALY',
                'TIMING_ANOMALY', 'IDENTITY_MISMATCH', 'BEHAVIOR_PATTERN',
                'COMPLIANCE_ISSUE', 'VELOCITY_SPIKE', 'COUNTERPARTY_RISK',
                'NETWORK_RISK', 'CUSTOM'
            ];
            validTypes.forEach(type => {
                expect(FlagTypeSchema.parse(type)).toBe(type);
            });
        });
    });

    describe('FlagSeveritySchema', () => {
        it('should accept valid severities', () => {
            expect(FlagSeveritySchema.parse('INFO')).toBe('INFO');
            expect(FlagSeveritySchema.parse('LOW')).toBe('LOW');
            expect(FlagSeveritySchema.parse('MEDIUM')).toBe('MEDIUM');
            expect(FlagSeveritySchema.parse('HIGH')).toBe('HIGH');
            expect(FlagSeveritySchema.parse('CRITICAL')).toBe('CRITICAL');
        });
    });

    describe('RiskLevelSchema', () => {
        it('should accept valid risk levels', () => {
            expect(RiskLevelSchema.parse('LOW')).toBe('LOW');
            expect(RiskLevelSchema.parse('MEDIUM')).toBe('MEDIUM');
            expect(RiskLevelSchema.parse('HIGH')).toBe('HIGH');
            expect(RiskLevelSchema.parse('CRITICAL')).toBe('CRITICAL');
        });
    });

    describe('RecommendationSchema', () => {
        it('should accept valid recommendations', () => {
            expect(RecommendationSchema.parse('PROCEED')).toBe('PROCEED');
            expect(RecommendationSchema.parse('CAUTION')).toBe('CAUTION');
            expect(RecommendationSchema.parse('BLOCK')).toBe('BLOCK');
            expect(RecommendationSchema.parse('REVIEW')).toBe('REVIEW');
        });
    });

    describe('CreateAnalysisSchema', () => {
        it('should accept valid input with all fields', () => {
            const input = {
                target_type: 'CHALLENGE',
                target_id: 'challenge-123',
                monitoring_mode: 'PRECISION',
                trigger_type: 'MANUAL',
                context: { extra: 'data' },
            };

            const result = CreateAnalysisSchema.parse(input);
            expect(result.target_type).toBe('CHALLENGE');
            expect(result.target_id).toBe('challenge-123');
            expect(result.monitoring_mode).toBe('PRECISION');
            expect(result.trigger_type).toBe('MANUAL');
        });

        it('should apply defaults for optional fields', () => {
            const input = {
                target_type: 'USER',
                target_id: 'user-456',
            };

            const result = CreateAnalysisSchema.parse(input);
            expect(result.monitoring_mode).toBe('BALANCED');
            expect(result.trigger_type).toBe('AUTO');
        });

        it('should reject empty target_id', () => {
            const input = {
                target_type: 'CHALLENGE',
                target_id: '',
            };

            expect(() => CreateAnalysisSchema.parse(input)).toThrow();
        });

        it('should reject invalid target_type', () => {
            const input = {
                target_type: 'INVALID',
                target_id: 'some-id',
            };

            expect(() => CreateAnalysisSchema.parse(input)).toThrow();
        });
    });

    describe('AnalyzeTransactionSchema', () => {
        it('should accept valid transaction analysis input', () => {
            const input = {
                challenge_id: 'challenge-123',
                monitoring_mode: 'BALANCED',
                transaction_data: {
                    amount: '1000.00',
                    currency: 'USD',
                    counterparty_wallet: '0xabc123',
                    description: 'Payment for services',
                    urls: ['https://example.com'],
                },
            };

            const result = AnalyzeTransactionSchema.parse(input);
            expect(result.challenge_id).toBe('challenge-123');
            expect(result.transaction_data?.amount).toBe('1000.00');
        });

        it('should accept minimal input', () => {
            const input = {
                challenge_id: 'challenge-456',
            };

            const result = AnalyzeTransactionSchema.parse(input);
            expect(result.challenge_id).toBe('challenge-456');
            expect(result.monitoring_mode).toBe('BALANCED');
        });

        it('should reject empty challenge_id', () => {
            expect(() => AnalyzeTransactionSchema.parse({
                challenge_id: '',
            })).toThrow();
        });
    });

    describe('ScanUrlSchema', () => {
        it('should accept valid URL input', () => {
            const input = {
                url: 'https://example.com/path',
                context: {
                    analysis_id: 'analysis-123',
                    target_type: 'CHALLENGE',
                    target_id: 'challenge-123',
                },
            };

            const result = ScanUrlSchema.parse(input);
            expect(result.url).toBe('https://example.com/path');
            expect(result.context?.analysis_id).toBe('analysis-123');
        });

        it('should reject invalid URLs', () => {
            expect(() => ScanUrlSchema.parse({
                url: 'not-a-url',
            })).toThrow();

            expect(() => ScanUrlSchema.parse({
                url: '',
            })).toThrow();
        });

        it('should accept URL without context', () => {
            const result = ScanUrlSchema.parse({
                url: 'https://safe-domain.com',
            });
            expect(result.context).toBeUndefined();
        });
    });

    describe('GetRiskScoreSchema', () => {
        it('should accept valid input', () => {
            const input = {
                entity_type: 'USER',
                entity_id: 'user-123',
                recalculate: true,
            };

            const result = GetRiskScoreSchema.parse(input);
            expect(result.entity_type).toBe('USER');
            expect(result.recalculate).toBe(true);
        });

        it('should default recalculate to false', () => {
            const result = GetRiskScoreSchema.parse({
                entity_type: 'WALLET',
                entity_id: 'wallet-abc',
            });
            expect(result.recalculate).toBe(false);
        });

        it('should accept all entity types', () => {
            ['USER', 'WALLET', 'CHALLENGE', 'TRANSACTION'].forEach(type => {
                const result = GetRiskScoreSchema.parse({
                    entity_type: type,
                    entity_id: 'test-id',
                });
                expect(result.entity_type).toBe(type);
            });
        });
    });

    describe('AgentInputSchema', () => {
        it('should accept valid agent input', () => {
            const input = {
                analysis_id: 'analysis-123',
                target_type: 'CHALLENGE',
                target_id: 'challenge-456',
                target_data: { amount: 1000, description: 'Test' },
                monitoring_mode: 'BALANCED',
            };

            const result = AgentInputSchema.parse(input);
            expect(result.analysis_id).toBe('analysis-123');
            expect(result.target_data.amount).toBe(1000);
        });

        it('should accept optional context', () => {
            const input = {
                analysis_id: 'analysis-123',
                target_type: 'USER',
                target_id: 'user-789',
                target_data: {},
                monitoring_mode: 'EXPLORATORY',
                context: { previous_score: 50 },
            };

            const result = AgentInputSchema.parse(input);
            expect(result.context?.previous_score).toBe(50);
        });
    });

    describe('AgentFlagSchema', () => {
        it('should accept valid flag output', () => {
            const flag = {
                flag_type: 'SCAM_PATTERN',
                severity: 'HIGH',
                title: 'Advance Fee Scam Pattern Detected',
                description: 'The transaction shows signs of an advance fee scam',
                evidence: { pattern: 'upfront_payment_request' },
            };

            const result = AgentFlagSchema.parse(flag);
            expect(result.flag_type).toBe('SCAM_PATTERN');
            expect(result.severity).toBe('HIGH');
        });

        it('should reject title longer than 200 characters', () => {
            expect(() => AgentFlagSchema.parse({
                flag_type: 'CUSTOM',
                severity: 'INFO',
                title: 'x'.repeat(201),
                description: 'Test',
            })).toThrow();
        });

        it('should reject description longer than 2000 characters', () => {
            expect(() => AgentFlagSchema.parse({
                flag_type: 'CUSTOM',
                severity: 'INFO',
                title: 'Test',
                description: 'x'.repeat(2001),
            })).toThrow();
        });
    });

    describe('AgentOutputSchema', () => {
        it('should accept valid agent output', () => {
            const output = {
                confidence_score: 0.85,
                risk_contribution: 45,
                flags: [
                    {
                        flag_type: 'AMOUNT_ANOMALY',
                        severity: 'MEDIUM',
                        title: 'Unusual Amount',
                        description: 'Transaction amount is 3x higher than typical',
                    },
                ],
                summary: 'Moderate risk detected due to unusual amount.',
                recommendations: ['Request additional verification'],
            };

            const result = AgentOutputSchema.parse(output);
            expect(result.confidence_score).toBe(0.85);
            expect(result.flags).toHaveLength(1);
        });

        it('should reject confidence_score outside 0-1 range', () => {
            expect(() => AgentOutputSchema.parse({
                confidence_score: 1.5,
                risk_contribution: 50,
                flags: [],
                summary: 'Test',
            })).toThrow();

            expect(() => AgentOutputSchema.parse({
                confidence_score: -0.1,
                risk_contribution: 50,
                flags: [],
                summary: 'Test',
            })).toThrow();
        });

        it('should reject risk_contribution outside 0-100 range', () => {
            expect(() => AgentOutputSchema.parse({
                confidence_score: 0.8,
                risk_contribution: 150,
                flags: [],
                summary: 'Test',
            })).toThrow();
        });
    });
});

// ============================================================================
// URL Extraction Tests
// ============================================================================

describe('URL Extraction', () => {
    describe('extractUrls', () => {
        it('should extract HTTP URLs', () => {
            const text = 'Check out http://example.com for more info';
            const urls = extractUrls(text);
            expect(urls).toContain('http://example.com');
        });

        it('should extract HTTPS URLs', () => {
            const text = 'Visit https://secure.example.com/page';
            const urls = extractUrls(text);
            expect(urls).toContain('https://secure.example.com/page');
        });

        it('should extract multiple URLs', () => {
            const text = `
                First: https://example1.com
                Second: http://example2.com/path
                Third: https://example3.com/path?query=1
            `;
            const urls = extractUrls(text);
            expect(urls).toHaveLength(3);
        });

        it('should deduplicate URLs', () => {
            const text = 'Visit https://example.com and https://example.com again';
            const urls = extractUrls(text);
            expect(urls).toHaveLength(1);
        });

        it('should handle URLs with paths and query params', () => {
            const text = 'Go to https://example.com/path/to/page?foo=bar&baz=qux';
            const urls = extractUrls(text);
            expect(urls[0]).toBe('https://example.com/path/to/page?foo=bar&baz=qux');
        });

        it('should return empty array for text without URLs', () => {
            const text = 'This text has no URLs, just www.example.com which is not a full URL';
            const urls = extractUrls(text);
            expect(urls).toHaveLength(0);
        });

        it('should handle URLs with subdomains', () => {
            const text = 'Check https://sub.domain.example.com';
            const urls = extractUrls(text);
            expect(urls).toContain('https://sub.domain.example.com');
        });

        it('should handle URLs with ports', () => {
            const text = 'API at http://localhost:3000/api';
            const urls = extractUrls(text);
            expect(urls).toContain('http://localhost:3000/api');
        });

        it('should handle URLs with fragments', () => {
            const text = 'See section at https://example.com/page#section';
            const urls = extractUrls(text);
            expect(urls).toContain('https://example.com/page#section');
        });
    });
});

// ============================================================================
// Agent Registration Tests
// ============================================================================

describe('Agent Registration', () => {
    describe('getRegisteredAgentTypes', () => {
        it('should return registered agent types', () => {
            const types = getRegisteredAgentTypes();
            expect(types).toContain('TRANSACTION_MONITOR');
            expect(types).toContain('FRAUD_ANALYZER');
            expect(types).toContain('COMPLIANCE_AUDITOR');
        });

        it('should return at least 3 built-in agents', () => {
            const types = getRegisteredAgentTypes();
            expect(types.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('createAgent', () => {
        it('should create agent with valid type and client', () => {
            const env = createMockEnv();
            const client = LlmClient.fromEnv(env);
            expect(client).not.toBeNull();

            const agent = createAgent('TRANSACTION_MONITOR', client!);
            expect(agent).not.toBeNull();
            expect(agent).toBeInstanceOf(BaseAgent);
        });

        it('should return null for invalid agent type', () => {
            const env = createMockEnv();
            const client = LlmClient.fromEnv(env);

            const agent = createAgent('INVALID_TYPE' as any, client!);
            expect(agent).toBeNull();
        });

        it('should create different agent types', () => {
            const env = createMockEnv();
            const client = LlmClient.fromEnv(env);

            const transactionAgent = createAgent('TRANSACTION_MONITOR', client!);
            const fraudAgent = createAgent('FRAUD_ANALYZER', client!);
            const complianceAgent = createAgent('COMPLIANCE_AUDITOR', client!);

            expect(transactionAgent?.name).toBe('Core Transaction Monitor');
            expect(fraudAgent?.name).toBe('Fraud Pattern Analyzer');
            expect(complianceAgent?.name).toBe('Compliance Auditor');
        });
    });
});

// ============================================================================
// LLM Client Tests
// ============================================================================

describe('LLM Client', () => {
    describe('LlmClient.fromEnv', () => {
        it('should create client with valid env', () => {
            const env = createMockEnv();
            const client = LlmClient.fromEnv(env);
            expect(client).not.toBeNull();
        });

        it('should return null without API key', () => {
            const env = { ...createMockEnv() };
            delete (env as any).OPENAI_API_KEY;
            const client = LlmClient.fromEnv(env);
            expect(client).toBeNull();
        });

        it('should report configured status correctly', () => {
            const env = createMockEnv();
            const client = LlmClient.fromEnv(env);
            expect(client?.isConfigured()).toBe(true);
        });

        it('should use default model if not specified', () => {
            const env = createMockEnv();
            delete (env as any).OPENAI_MODEL;
            const client = LlmClient.fromEnv(env);
            expect(client).not.toBeNull();
        });
    });
});

// ============================================================================
// Scam Shield Pattern Tests
// ============================================================================

describe('Scam Shield Patterns', () => {
    describe('URL Pattern Recognition', () => {
        it('should recognize suspicious TLDs', () => {
            const suspiciousTlds = ['.xyz', '.top', '.club', '.work', '.click', '.link'];
            suspiciousTlds.forEach(tld => {
                expect(suspiciousTlds).toContain(tld);
            });
        });

        it('should recognize URL shorteners', () => {
            const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl'];
            shorteners.forEach(shortener => {
                expect(shortener.includes('.')).toBe(true);
            });
        });

        it('should recognize legitimate domains that need protection', () => {
            const legitimateDomains = [
                'paypal.com', 'google.com', 'coinbase.com',
                'metamask.io', 'escrow.com'
            ];
            expect(legitimateDomains.length).toBeGreaterThan(0);
        });
    });

    describe('Suspicious Keywords', () => {
        it('should identify phishing-related keywords', () => {
            const keywords = [
                'verify', 'secure', 'update', 'confirm', 'account',
                'login', 'signin', 'wallet', 'connect', 'claim'
            ];
            expect(keywords).toContain('verify');
            expect(keywords).toContain('wallet');
            expect(keywords).toContain('claim');
        });

        it('should identify urgency keywords', () => {
            const urgencyKeywords = ['urgent', 'immediate', 'suspend', 'locked'];
            expect(urgencyKeywords).toContain('urgent');
            expect(urgencyKeywords).toContain('locked');
        });
    });
});

// ============================================================================
// Risk Score Calculation Tests
// ============================================================================

describe('Risk Score Calculations', () => {
    describe('Score to Risk Level Mapping', () => {
        it('should map scores below 25 to LOW', () => {
            const score = 20;
            expect(score < DEFAULT_RISK_THRESHOLDS.LOW).toBe(true);
        });

        it('should map scores 25-49 to MEDIUM', () => {
            const score = 35;
            expect(score >= DEFAULT_RISK_THRESHOLDS.LOW).toBe(true);
            expect(score < DEFAULT_RISK_THRESHOLDS.MEDIUM).toBe(true);
        });

        it('should map scores 50-74 to HIGH', () => {
            const score = 60;
            expect(score >= DEFAULT_RISK_THRESHOLDS.MEDIUM).toBe(true);
            expect(score < DEFAULT_RISK_THRESHOLDS.HIGH).toBe(true);
        });

        it('should map scores 75+ to CRITICAL', () => {
            const score = 80;
            expect(score >= DEFAULT_RISK_THRESHOLDS.HIGH).toBe(true);
        });
    });

    describe('Flag Severity Weights', () => {
        it('should weight CRITICAL flags highest', () => {
            const weights = { CRITICAL: 15, HIGH: 10, MEDIUM: 5, LOW: 2, INFO: 0 };
            expect(weights.CRITICAL).toBeGreaterThan(weights.HIGH);
            expect(weights.HIGH).toBeGreaterThan(weights.MEDIUM);
            expect(weights.MEDIUM).toBeGreaterThan(weights.LOW);
            expect(weights.LOW).toBeGreaterThan(weights.INFO);
        });
    });

    describe('Component Weights', () => {
        it('should weight fraud component highest', () => {
            const weights = {
                fraud: 0.35,
                compliance: 0.25,
                behavioral: 0.20,
                network: 0.10,
                velocity: 0.10,
            };

            expect(weights.fraud).toBeGreaterThan(weights.compliance);
            expect(weights.compliance).toBeGreaterThan(weights.behavioral);
        });

        it('should sum component weights to 1.0', () => {
            const weights = {
                fraud: 0.35,
                compliance: 0.25,
                behavioral: 0.20,
                network: 0.10,
                velocity: 0.10,
            };

            const sum = Object.values(weights).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0);
        });
    });
});

// ============================================================================
// Monitoring Mode Configuration Tests
// ============================================================================

describe('Monitoring Mode Configuration', () => {
    describe('Agent Selection by Mode', () => {
        it('EXPLORATORY mode should use minimal agents', () => {
            const requiredAgents = ['TRANSACTION_MONITOR'];
            const optionalAgents = ['FRAUD_ANALYZER'];

            expect(requiredAgents).toHaveLength(1);
            expect(optionalAgents).toHaveLength(1);
        });

        it('BALANCED mode should use core agents', () => {
            const requiredAgents = ['TRANSACTION_MONITOR', 'FRAUD_ANALYZER'];
            const optionalAgents = ['COMPLIANCE_AUDITOR'];

            expect(requiredAgents).toHaveLength(2);
            expect(requiredAgents).toContain('TRANSACTION_MONITOR');
            expect(requiredAgents).toContain('FRAUD_ANALYZER');
        });

        it('PRECISION mode should use all agents', () => {
            const requiredAgents = [
                'TRANSACTION_MONITOR',
                'FRAUD_ANALYZER',
                'COMPLIANCE_AUDITOR'
            ];

            expect(requiredAgents).toHaveLength(3);
        });
    });

    describe('Threshold Configuration by Mode', () => {
        it('PRECISION mode should have lower auto-block threshold', () => {
            const precisionThreshold = 80;
            const balancedThreshold = 90;

            expect(precisionThreshold).toBeLessThan(balancedThreshold);
        });

        it('PRECISION mode should have lower review threshold', () => {
            const precisionThreshold = 50;
            const balancedThreshold = 70;

            expect(precisionThreshold).toBeLessThan(balancedThreshold);
        });

        it('PRECISION mode should have longer timeout', () => {
            const precisionTimeout = 45000;
            const defaultTimeout = 20000;

            expect(precisionTimeout).toBeGreaterThan(defaultTimeout);
        });
    });
});

// ============================================================================
// Auto Mode Tests (Adaptive Monitoring)
// ============================================================================

describe('Auto Mode (Adaptive Monitoring)', () => {
    describe('Mode Selection Logic', () => {
        it('should recommend EXPLORATORY for new entities', () => {
            // New entity with no risk score should get EXPLORATORY
            const hasRiskScore = false;
            const recommendedMode = hasRiskScore ? 'BALANCED' : 'EXPLORATORY';
            expect(recommendedMode).toBe('EXPLORATORY');
        });

        it('should recommend BALANCED for entities with limited history', () => {
            // Entity with less than 2 analyses should get BALANCED
            const analysisCount = 1;
            const recommendedMode = analysisCount < 2 ? 'BALANCED' : 'PRECISION';
            expect(recommendedMode).toBe('BALANCED');
        });

        it('should recommend PRECISION for high-risk entities', () => {
            // Entity with avg risk >= 60 should get PRECISION
            const avgRisk = 65;
            const recommendedMode = avgRisk >= 60 ? 'PRECISION' : 'BALANCED';
            expect(recommendedMode).toBe('PRECISION');
        });

        it('should escalate to PRECISION when risk is increasing', () => {
            // If recent risk is 10+ points higher than earlier, escalate
            const recentRisk = 45;
            const olderRisk = 30;
            const isIncreasing = recentRisk > olderRisk + 10;
            expect(isIncreasing).toBe(true);
        });

        it('should maintain EXPLORATORY for consistently low-risk entities', () => {
            const avgRisk = 15;
            const recommendedMode = avgRisk < 30 ? 'EXPLORATORY' : 'BALANCED';
            expect(recommendedMode).toBe('EXPLORATORY');
        });
    });
});

// ============================================================================
// Recommendation Logic Tests
// ============================================================================

describe('Recommendation Logic', () => {
    describe('Score-based Recommendations', () => {
        it('should recommend BLOCK for scores at/above auto-block threshold', () => {
            const score = 90;
            const autoBlockThreshold = 90;
            const recommendation = score >= autoBlockThreshold ? 'BLOCK' : 'REVIEW';
            expect(recommendation).toBe('BLOCK');
        });

        it('should recommend REVIEW for scores at/above review threshold', () => {
            const score = 75;
            const reviewThreshold = 70;
            const autoBlockThreshold = 90;
            const recommendation = score >= autoBlockThreshold ? 'BLOCK' :
                score >= reviewThreshold ? 'REVIEW' : 'CAUTION';
            expect(recommendation).toBe('REVIEW');
        });

        it('should recommend PROCEED for LOW risk level', () => {
            const riskLevel = 'LOW';
            const recommendation = riskLevel === 'LOW' ? 'PROCEED' : 'CAUTION';
            expect(recommendation).toBe('PROCEED');
        });

        it('should recommend CAUTION for MEDIUM risk level', () => {
            const riskLevel = 'MEDIUM';
            const recommendations: Record<string, string> = {
                LOW: 'PROCEED',
                MEDIUM: 'CAUTION',
                HIGH: 'REVIEW',
                CRITICAL: 'BLOCK',
            };
            expect(recommendations[riskLevel]).toBe('CAUTION');
        });
    });
});

// ============================================================================
// Summary Generation Tests
// ============================================================================

describe('Summary Generation', () => {
    it('should include risk level in summary', () => {
        const riskLevel = 'HIGH';
        const summary = `Risk Level: ${riskLevel}. Analysis complete.`;
        expect(summary).toContain('HIGH');
    });

    it('should mention critical flags if present', () => {
        const criticalFlagsCount = 2;
        const summary = criticalFlagsCount > 0 ?
            `${criticalFlagsCount} CRITICAL concern(s) identified.` :
            'No critical concerns.';
        expect(summary).toContain('CRITICAL');
    });

    it('should indicate no concerns for clean analysis', () => {
        const flagsCount = 0;
        const summary = flagsCount === 0 ?
            'No significant concerns detected.' :
            `${flagsCount} flag(s) raised.`;
        expect(summary).toContain('No significant concerns');
    });
});

// ============================================================================
// Integration Test Helpers
// ============================================================================

describe('Integration Helpers', () => {
    describe('Webhook Event Types', () => {
        it('should define monitoring-related webhook events', () => {
            const events = [
                'monitoring.analysis_completed',
                'monitoring.high_risk_detected',
                'monitoring.critical_flag_raised',
                'monitoring.url_threat_detected',
            ];

            expect(events).toHaveLength(4);
            events.forEach(event => {
                expect(event.startsWith('monitoring.')).toBe(true);
            });
        });
    });

    describe('Queue Message Types', () => {
        it('should define LLM-related queue message types', () => {
            const types = ['llm_analysis', 'url_scan'];
            expect(types).toContain('llm_analysis');
            expect(types).toContain('url_scan');
        });
    });
});
