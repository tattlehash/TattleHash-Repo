/**
 * ENF (Evidence-and-Forward) Tests
 *
 * Comprehensive tests for evidence bundling, multi-party
 * acknowledgment, signatures, and audit trails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CreateEnfBundleSchema,
    AcknowledgeEnfSchema,
    DeclineEnfSchema,
    ENF_DEFAULTS,
    canTransitionBundle,
    canTransitionRecipient,
    createEip191Message,
    BUNDLE_TRANSITIONS,
    RECIPIENT_TRANSITIONS,
} from '../enf/types';
import {
    createEnfBundle,
    getEnfBundle,
    getRecipientsByBundle,
    getRecipientByToken,
    updateBundleStatus,
    updateRecipientStatus,
} from '../enf/core';
import { logEnfEvent, getEventsByBundle, exportBundleAuditTrail } from '../enf/events';
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

    const mockQueue = {
        send: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        GATE_KV: mockKv,
        TATTLEHASH_QUEUE: mockQueue,
        ENF_ENABLED: 'true',
    } as any;
}

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('ENF Schema Validation', () => {
    describe('CreateEnfBundleSchema', () => {
        it('should accept valid input with all fields', () => {
            const input = {
                title: 'Test Evidence Bundle',
                description: 'A test bundle',
                evidence: { key: 'value', data: [1, 2, 3] },
                recipients: [
                    { type: 'EMAIL', identifier: 'test@example.com' },
                    { type: 'WALLET', identifier: '0x1234567890abcdef' },
                ],
                expiry_ms: 7 * 24 * 60 * 60 * 1000,
            };

            const result = CreateEnfBundleSchema.parse(input);
            expect(result.title).toBe('Test Evidence Bundle');
            expect(result.recipients.length).toBe(2);
        });

        it('should accept valid input with minimum fields', () => {
            const input = {
                title: 'Minimal',
                evidence: { foo: 'bar' },
                recipients: [{ type: 'EMAIL', identifier: 'a@b.com' }],
            };

            const result = CreateEnfBundleSchema.parse(input);
            expect(result.title).toBe('Minimal');
            expect(result.expiry_ms).toBeUndefined();
        });

        it('should reject empty title', () => {
            const input = {
                title: '',
                evidence: {},
                recipients: [{ type: 'EMAIL', identifier: 'a@b.com' }],
            };

            expect(() => CreateEnfBundleSchema.parse(input)).toThrow();
        });

        it('should reject empty recipients array', () => {
            const input = {
                title: 'Test',
                evidence: {},
                recipients: [],
            };

            expect(() => CreateEnfBundleSchema.parse(input)).toThrow();
        });

        it('should reject too many recipients', () => {
            const input = {
                title: 'Test',
                evidence: {},
                recipients: Array(11).fill({ type: 'EMAIL', identifier: 'a@b.com' }),
            };

            expect(() => CreateEnfBundleSchema.parse(input)).toThrow();
        });

        it('should reject invalid expiry_ms', () => {
            const input = {
                title: 'Test',
                evidence: {},
                recipients: [{ type: 'EMAIL', identifier: 'a@b.com' }],
                expiry_ms: 1000, // Less than MIN_EXPIRY_MS
            };

            expect(() => CreateEnfBundleSchema.parse(input)).toThrow();
        });

        it('should accept expiry_ms at maximum boundary', () => {
            const input = {
                title: 'Test',
                evidence: {},
                recipients: [{ type: 'EMAIL', identifier: 'a@b.com' }],
                expiry_ms: ENF_DEFAULTS.MAX_EXPIRY_MS,
            };

            const result = CreateEnfBundleSchema.parse(input);
            expect(result.expiry_ms).toBe(ENF_DEFAULTS.MAX_EXPIRY_MS);
        });
    });

    describe('AcknowledgeEnfSchema', () => {
        it('should accept click acknowledgment', () => {
            const input = {
                token: 'enf_abc123',
                signature_type: 'CLICK_ACK',
            };

            const result = AcknowledgeEnfSchema.parse(input);
            expect(result.signature_type).toBe('CLICK_ACK');
        });

        it('should accept EIP191 with signature', () => {
            const input = {
                token: 'enf_abc123',
                signature_type: 'EIP191',
                signature: '0x1234...',
                signer_address: '0xabcd...',
            };

            const result = AcknowledgeEnfSchema.parse(input);
            expect(result.signature_type).toBe('EIP191');
            expect(result.signature).toBe('0x1234...');
        });

        it('should accept optional message', () => {
            const input = {
                token: 'enf_abc123',
                signature_type: 'CLICK_ACK',
                message: 'I acknowledge receipt',
            };

            const result = AcknowledgeEnfSchema.parse(input);
            expect(result.message).toBe('I acknowledge receipt');
        });

        it('should reject empty token', () => {
            const input = {
                token: '',
                signature_type: 'CLICK_ACK',
            };

            expect(() => AcknowledgeEnfSchema.parse(input)).toThrow();
        });

        it('should reject invalid signature type', () => {
            const input = {
                token: 'enf_abc123',
                signature_type: 'INVALID',
            };

            expect(() => AcknowledgeEnfSchema.parse(input)).toThrow();
        });
    });

    describe('DeclineEnfSchema', () => {
        it('should accept decline with reason', () => {
            const input = {
                token: 'enf_abc123',
                reason: 'Not relevant to me',
            };

            const result = DeclineEnfSchema.parse(input);
            expect(result.reason).toBe('Not relevant to me');
        });

        it('should accept decline without reason', () => {
            const input = {
                token: 'enf_abc123',
            };

            const result = DeclineEnfSchema.parse(input);
            expect(result.reason).toBeUndefined();
        });
    });
});

// ============================================================================
// State Machine Tests
// ============================================================================

describe('ENF State Machine', () => {
    describe('Bundle Transitions', () => {
        it('should allow DRAFT -> SENT', () => {
            expect(canTransitionBundle('DRAFT', 'SENT')).toBe(true);
        });

        it('should allow DRAFT -> CANCELLED', () => {
            expect(canTransitionBundle('DRAFT', 'CANCELLED')).toBe(true);
        });

        it('should allow SENT -> PARTIAL', () => {
            expect(canTransitionBundle('SENT', 'PARTIAL')).toBe(true);
        });

        it('should allow SENT -> COMPLETE', () => {
            expect(canTransitionBundle('SENT', 'COMPLETE')).toBe(true);
        });

        it('should allow SENT -> EXPIRED', () => {
            expect(canTransitionBundle('SENT', 'EXPIRED')).toBe(true);
        });

        it('should allow PARTIAL -> COMPLETE', () => {
            expect(canTransitionBundle('PARTIAL', 'COMPLETE')).toBe(true);
        });

        it('should NOT allow COMPLETE -> anything', () => {
            expect(canTransitionBundle('COMPLETE', 'DRAFT')).toBe(false);
            expect(canTransitionBundle('COMPLETE', 'SENT')).toBe(false);
            expect(canTransitionBundle('COMPLETE', 'EXPIRED')).toBe(false);
        });

        it('should NOT allow DRAFT -> COMPLETE', () => {
            expect(canTransitionBundle('DRAFT', 'COMPLETE')).toBe(false);
        });

        it('should NOT allow backwards transitions', () => {
            expect(canTransitionBundle('SENT', 'DRAFT')).toBe(false);
            expect(canTransitionBundle('PARTIAL', 'SENT')).toBe(false);
        });
    });

    describe('Recipient Transitions', () => {
        it('should allow PENDING -> SENT', () => {
            expect(canTransitionRecipient('PENDING', 'SENT')).toBe(true);
        });

        it('should allow SENT -> DELIVERED', () => {
            expect(canTransitionRecipient('SENT', 'DELIVERED')).toBe(true);
        });

        it('should allow SENT -> ACKNOWLEDGED (skip delivered)', () => {
            expect(canTransitionRecipient('SENT', 'ACKNOWLEDGED')).toBe(true);
        });

        it('should allow DELIVERED -> ACKNOWLEDGED', () => {
            expect(canTransitionRecipient('DELIVERED', 'ACKNOWLEDGED')).toBe(true);
        });

        it('should allow DELIVERED -> DECLINED', () => {
            expect(canTransitionRecipient('DELIVERED', 'DECLINED')).toBe(true);
        });

        it('should NOT allow ACKNOWLEDGED -> anything', () => {
            expect(canTransitionRecipient('ACKNOWLEDGED', 'DECLINED')).toBe(false);
            expect(canTransitionRecipient('ACKNOWLEDGED', 'EXPIRED')).toBe(false);
        });

        it('should NOT allow DECLINED -> anything', () => {
            expect(canTransitionRecipient('DECLINED', 'ACKNOWLEDGED')).toBe(false);
        });
    });
});

// ============================================================================
// EIP-191 Message Tests
// ============================================================================

describe('EIP-191 Message Creation', () => {
    it('should create properly formatted message', () => {
        const message = createEip191Message(
            'enf-123',
            'abc123hash',
            'recipient-456',
            1700000000000
        );

        expect(message).toContain('TattleHash Evidence Acknowledgment');
        expect(message).toContain('ENF ID: enf-123');
        expect(message).toContain('Evidence Hash: abc123hash');
        expect(message).toContain('Recipient ID: recipient-456');
        expect(message).toContain('By signing this message');
    });

    it('should include ISO timestamp', () => {
        const timestamp = 1700000000000;
        const message = createEip191Message('id', 'hash', 'rec', timestamp);
        const isoDate = new Date(timestamp).toISOString();

        expect(message).toContain(isoDate);
    });
});

// ============================================================================
// Core Operations Tests
// ============================================================================

describe('ENF Core Operations', () => {
    describe('createEnfBundle', () => {
        it('should create bundle with generated ID', async () => {
            const env = createMockEnv();
            const input = {
                title: 'Test Bundle',
                evidence: { foo: 'bar' },
                recipients: [{ type: 'EMAIL' as const, identifier: 'test@example.com' }],
            };

            const result = await createEnfBundle(env, 'user-123', input);

            expect(result.bundle.id).toBeDefined();
            expect(result.bundle.id.length).toBeGreaterThan(0);
            expect(result.bundle.title).toBe('Test Bundle');
            expect(result.bundle.status).toBe('DRAFT');
        });

        it('should create recipients with delivery tokens', async () => {
            const env = createMockEnv();
            const input = {
                title: 'Test',
                evidence: {},
                recipients: [
                    { type: 'EMAIL' as const, identifier: 'a@b.com' },
                    { type: 'WALLET' as const, identifier: '0x123' },
                ],
            };

            const result = await createEnfBundle(env, 'user-123', input);

            expect(result.recipients.length).toBe(2);
            expect(result.recipients[0].delivery_token).toMatch(/^enf_/);
            expect(result.recipients[1].delivery_token).toMatch(/^enf_/);
            expect(result.recipients[0].delivery_token).not.toBe(result.recipients[1].delivery_token);
        });

        it('should compute evidence hash', async () => {
            const env = createMockEnv();
            const input = {
                title: 'Test',
                evidence: { important: 'data' },
                recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
            };

            const result = await createEnfBundle(env, 'user-123', input);

            expect(result.bundle.evidence_hash).toBeDefined();
            expect(result.bundle.evidence_hash.length).toBe(64); // SHA-256 hex
        });

        it('should set expiration from default', async () => {
            const env = createMockEnv();
            const before = Date.now();

            const input = {
                title: 'Test',
                evidence: {},
                recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
            };

            const result = await createEnfBundle(env, 'user-123', input);
            const after = Date.now();

            const expectedMinExpiry = before + ENF_DEFAULTS.DEFAULT_EXPIRY_MS;
            const expectedMaxExpiry = after + ENF_DEFAULTS.DEFAULT_EXPIRY_MS;

            expect(result.bundle.expires_at).toBeGreaterThanOrEqual(expectedMinExpiry);
            expect(result.bundle.expires_at).toBeLessThanOrEqual(expectedMaxExpiry);
        });

        it('should set custom expiration', async () => {
            const env = createMockEnv();
            const customExpiry = 2 * 24 * 60 * 60 * 1000; // 2 days

            const input = {
                title: 'Test',
                evidence: {},
                recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
                expiry_ms: customExpiry,
            };

            const result = await createEnfBundle(env, 'user-123', input);

            const diff = result.bundle.expires_at - result.bundle.created_at;
            expect(diff).toBe(customExpiry);
        });
    });
});

// ============================================================================
// Audit Trail Tests
// ============================================================================

describe('ENF Audit Trail', () => {
    describe('logEnfEvent', () => {
        it('should log event with all fields', async () => {
            const env = createMockEnv();

            const event = await logEnfEvent(env, {
                enf_id: 'bundle-123',
                event_type: 'CREATED',
                actor_type: 'INITIATOR',
                actor_identifier: 'user-456',
                details: JSON.stringify({ extra: 'info' }),
            });

            expect(event.id).toBeDefined();
            expect(event.enf_id).toBe('bundle-123');
            expect(event.event_type).toBe('CREATED');
            expect(event.actor_type).toBe('INITIATOR');
            expect(event.created_at).toBeDefined();
        });

        it('should log recipient-level event', async () => {
            const env = createMockEnv();

            const event = await logEnfEvent(env, {
                enf_id: 'bundle-123',
                recipient_id: 'recipient-789',
                event_type: 'ACKNOWLEDGED',
                actor_type: 'RECIPIENT',
                actor_identifier: 'test@example.com',
            });

            expect(event.recipient_id).toBe('recipient-789');
        });
    });

    describe('exportBundleAuditTrail', () => {
        it('should export audit with hash', async () => {
            const mockEvents = [
                {
                    id: 'evt-1',
                    enf_id: 'bundle-123',
                    event_type: 'CREATED',
                    actor_type: 'INITIATOR',
                    actor_identifier: 'user-123',
                    created_at: Date.now(),
                },
            ];

            const env = createMockEnv(mockEvents);
            const audit = await exportBundleAuditTrail(env, 'bundle-123');

            expect(audit.bundle_id).toBe('bundle-123');
            expect(audit.exported_at).toBeDefined();
            expect(audit.events.length).toBe(1);
            expect(audit.hash).toBeDefined();
            expect(audit.hash.length).toBe(64); // SHA-256 hex
        });

        it('should format timestamps as ISO strings', async () => {
            const now = Date.now();
            const mockEvents = [{
                id: 'evt-1',
                enf_id: 'bundle-123',
                event_type: 'SENT',
                actor_type: 'SYSTEM',
                created_at: now,
            }];

            const env = createMockEnv(mockEvents);
            const audit = await exportBundleAuditTrail(env, 'bundle-123');

            expect(audit.events[0].timestamp).toBe(new Date(now).toISOString());
        });
    });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('ENF Constants', () => {
    it('should have reasonable default expiry', () => {
        const days = ENF_DEFAULTS.DEFAULT_EXPIRY_MS / (24 * 60 * 60 * 1000);
        expect(days).toBe(7); // 7 days
    });

    it('should have minimum expiry of 1 hour', () => {
        const hours = ENF_DEFAULTS.MIN_EXPIRY_MS / (60 * 60 * 1000);
        expect(hours).toBe(1);
    });

    it('should have maximum expiry of 30 days', () => {
        const days = ENF_DEFAULTS.MAX_EXPIRY_MS / (24 * 60 * 60 * 1000);
        expect(days).toBe(30);
    });

    it('should limit to 10 recipients', () => {
        expect(ENF_DEFAULTS.MAX_RECIPIENTS).toBe(10);
    });

    it('should limit evidence size to 1MB', () => {
        expect(ENF_DEFAULTS.MAX_EVIDENCE_SIZE).toBe(1024 * 1024);
    });
});

// ============================================================================
// Transition Map Completeness Tests
// ============================================================================

describe('State Machine Completeness', () => {
    it('should have all bundle states in transitions map', () => {
        const allBundleStates = ['DRAFT', 'SENT', 'PARTIAL', 'COMPLETE', 'EXPIRED', 'CANCELLED'];
        for (const state of allBundleStates) {
            expect(BUNDLE_TRANSITIONS[state]).toBeDefined();
        }
    });

    it('should have all recipient states in transitions map', () => {
        const allRecipientStates = ['PENDING', 'SENT', 'DELIVERED', 'ACKNOWLEDGED', 'DECLINED', 'EXPIRED'];
        for (const state of allRecipientStates) {
            expect(RECIPIENT_TRANSITIONS[state]).toBeDefined();
        }
    });

    it('should have terminal states with no transitions', () => {
        expect(BUNDLE_TRANSITIONS['COMPLETE']).toEqual([]);
        expect(BUNDLE_TRANSITIONS['EXPIRED']).toEqual([]);
        expect(BUNDLE_TRANSITIONS['CANCELLED']).toEqual([]);

        expect(RECIPIENT_TRANSITIONS['ACKNOWLEDGED']).toEqual([]);
        expect(RECIPIENT_TRANSITIONS['DECLINED']).toEqual([]);
        expect(RECIPIENT_TRANSITIONS['EXPIRED']).toEqual([]);
    });
});

// ============================================================================
// Evidence Payload Tests
// ============================================================================

describe('Evidence Payload Handling', () => {
    it('should store evidence as JSON string', async () => {
        const env = createMockEnv();
        const evidence = {
            transaction_id: 'tx-123',
            amount: 1000,
            details: { nested: { deep: 'value' } },
            array_data: [1, 2, 3],
        };

        const input = {
            title: 'Test',
            evidence,
            recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
        };

        const result = await createEnfBundle(env, 'user-123', input);

        // Evidence payload should be serialized
        const parsed = JSON.parse(result.bundle.evidence_payload);
        expect(parsed).toEqual(evidence);
    });

    it('should generate consistent hash for same evidence', async () => {
        const env = createMockEnv();
        const evidence = { key: 'value' };

        const result1 = await createEnfBundle(env, 'user-1', {
            title: 'Test 1',
            evidence,
            recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
        });

        const result2 = await createEnfBundle(env, 'user-2', {
            title: 'Test 2',
            evidence,
            recipients: [{ type: 'WALLET' as const, identifier: '0x123' }],
        });

        // Same evidence should produce same hash
        expect(result1.bundle.evidence_hash).toBe(result2.bundle.evidence_hash);
    });

    it('should generate different hash for different evidence', async () => {
        const env = createMockEnv();

        const result1 = await createEnfBundle(env, 'user-1', {
            title: 'Test',
            evidence: { key: 'value1' },
            recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
        });

        const result2 = await createEnfBundle(env, 'user-1', {
            title: 'Test',
            evidence: { key: 'value2' },
            recipients: [{ type: 'EMAIL' as const, identifier: 'a@b.com' }],
        });

        expect(result1.bundle.evidence_hash).not.toBe(result2.bundle.evidence_hash);
    });
});

// ============================================================================
// Recipient Type Tests
// ============================================================================

describe('Recipient Types', () => {
    it('should support EMAIL recipients', async () => {
        const env = createMockEnv();

        const result = await createEnfBundle(env, 'user-123', {
            title: 'Test',
            evidence: {},
            recipients: [{ type: 'EMAIL', identifier: 'test@example.com' }],
        });

        expect(result.recipients[0].counterparty_type).toBe('EMAIL');
        expect(result.recipients[0].counterparty_identifier).toBe('test@example.com');
    });

    it('should support WALLET recipients', async () => {
        const env = createMockEnv();

        const result = await createEnfBundle(env, 'user-123', {
            title: 'Test',
            evidence: {},
            recipients: [{ type: 'WALLET', identifier: '0x742d35Cc6634C0532925a3b844Bc9e7595f5c' }],
        });

        expect(result.recipients[0].counterparty_type).toBe('WALLET');
    });

    it('should support USER_ID recipients', async () => {
        const env = createMockEnv();

        const result = await createEnfBundle(env, 'user-123', {
            title: 'Test',
            evidence: {},
            recipients: [{ type: 'USER_ID', identifier: 'user-456' }],
        });

        expect(result.recipients[0].counterparty_type).toBe('USER_ID');
    });

    it('should support mixed recipient types', async () => {
        const env = createMockEnv();

        const result = await createEnfBundle(env, 'user-123', {
            title: 'Test',
            evidence: {},
            recipients: [
                { type: 'EMAIL', identifier: 'a@b.com' },
                { type: 'WALLET', identifier: '0x123' },
                { type: 'USER_ID', identifier: 'user-789' },
            ],
        });

        expect(result.recipients.length).toBe(3);
        expect(result.recipients[0].counterparty_type).toBe('EMAIL');
        expect(result.recipients[1].counterparty_type).toBe('WALLET');
        expect(result.recipients[2].counterparty_type).toBe('USER_ID');
    });
});
