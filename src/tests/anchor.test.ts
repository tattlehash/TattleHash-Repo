/**
 * Anchor system tests - Merkle trees, chain providers, anchor service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    buildMerkleTree,
    verifyMerkleProof,
    createLeafData,
} from '../anchor/merkle';

import { PolygonProvider, CHAIN_CONFIGS } from '../anchor/chains';

import {
    anchorRecord,
    anchorBatch,
    queryTransactionStatus,
} from '../anchor/service';

import type { Env } from '../types';
import type { AnchorJob, AttestRecord } from '../anchor';

// Create mock env
function createMockEnv(overrides: Partial<Env> = {}): Env {
    return {
        TATTLEHASH_DB: {} as any,
        TATTLEHASH_KV: {} as any,
        TATTLEHASH_CONTENT_KV: {} as any,
        TATTLEHASH_ANCHOR_KV: {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue({ keys: [] }),
        } as any,
        TATTLEHASH_ERROR_KV: {} as any,
        ATT_KV: {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
        } as any,
        GATE_KV: {} as any,
        SHIELD_KV: {} as any,
        TATTLEHASH_QUEUE: {} as any,
        ANCHOR_MODE: 'mock',
        ...overrides,
    };
}

describe('Merkle Tree', () => {
    describe('buildMerkleTree', () => {
        it('should build tree with single item', async () => {
            const tree = await buildMerkleTree(['item1']);

            expect(tree.root).toBeDefined();
            expect(tree.root).toMatch(/^0x[a-f0-9]+$/);
            expect(tree.leaves).toHaveLength(1);
            expect(tree.proofs).toHaveLength(1);
            expect(tree.proofs[0].proof).toHaveLength(0);
        });

        it('should build tree with two items', async () => {
            const tree = await buildMerkleTree(['item1', 'item2']);

            expect(tree.root).toBeDefined();
            expect(tree.leaves).toHaveLength(2);
            expect(tree.proofs).toHaveLength(2);
            expect(tree.proofs[0].proof).toHaveLength(1);
            expect(tree.proofs[1].proof).toHaveLength(1);
        });

        it('should build tree with multiple items', async () => {
            const items = ['a', 'b', 'c', 'd', 'e'];
            const tree = await buildMerkleTree(items);

            expect(tree.root).toBeDefined();
            expect(tree.leaves).toHaveLength(5);
            expect(tree.proofs).toHaveLength(5);

            // Each proof should lead to the same root
            for (const proof of tree.proofs) {
                expect(proof.root).toBe(tree.root);
            }
        });

        it('should produce deterministic root', async () => {
            const items = ['x', 'y', 'z'];

            const tree1 = await buildMerkleTree(items);
            const tree2 = await buildMerkleTree(items);

            expect(tree1.root).toBe(tree2.root);
        });

        it('should throw on empty input', async () => {
            await expect(buildMerkleTree([])).rejects.toThrow('Cannot build Merkle tree with no items');
        });
    });

    describe('verifyMerkleProof', () => {
        it('should verify valid proof', async () => {
            const tree = await buildMerkleTree(['a', 'b', 'c', 'd']);

            for (const proof of tree.proofs) {
                const isValid = await verifyMerkleProof(proof);
                expect(isValid).toBe(true);
            }
        });

        it('should reject invalid proof', async () => {
            const tree = await buildMerkleTree(['a', 'b', 'c', 'd']);
            const proof = tree.proofs[0];

            // Tamper with the proof
            const tamperedProof = {
                ...proof,
                root: '0x' + '00'.repeat(32),
            };

            const isValid = await verifyMerkleProof(tamperedProof);
            expect(isValid).toBe(false);
        });
    });

    describe('createLeafData', () => {
        it('should create consistent leaf data', () => {
            const timestamp = 1234567890;
            const leaf1 = createLeafData('id1', 'commit1', 'commit2', timestamp);
            const leaf2 = createLeafData('id1', 'commit1', 'commit2', timestamp);

            expect(leaf1).toBe(leaf2);
            expect(leaf1).toContain('id1');
            expect(leaf1).toContain('commit1');
        });

        it('should handle missing counterCommit', () => {
            const leaf = createLeafData('id1', 'commit1', undefined, 1000);

            expect(leaf).toBeDefined();
            expect(leaf).toContain('id1');
        });
    });
});

describe('Polygon Provider', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('configuration', () => {
        it('should have correct chain config', () => {
            expect(CHAIN_CONFIGS.polygon.networkId).toBe(137);
            expect(CHAIN_CONFIGS.polygon.name).toBe('Polygon PoS');
            expect(CHAIN_CONFIGS.polygon.confirmationsRequired).toBe(128);
        });
    });

    describe('getBlockNumber', () => {
        it('should parse block number from RPC response', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ result: '0x1234' }),
            });

            const provider = new PolygonProvider('https://polygon-rpc.com');
            const blockNumber = await provider.getBlockNumber();

            expect(blockNumber).toBe(0x1234);
            expect(global.fetch).toHaveBeenCalledWith(
                'https://polygon-rpc.com',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('eth_blockNumber'),
                })
            );
        });
    });

    describe('getTransactionStatus', () => {
        it('should return pending for unmined tx', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ result: null }),
            });

            const provider = new PolygonProvider('https://polygon-rpc.com');
            const status = await provider.getTransactionStatus('0x123');

            expect(status.confirmed).toBe(false);
            expect(status.confirmations).toBe(0);
        });

        it('should calculate confirmations for mined tx', async () => {
            global.fetch = vi.fn()
                // First call: eth_getTransactionReceipt
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        result: {
                            blockNumber: '0x100',
                            blockHash: '0xabc',
                            status: '0x1',
                            gasUsed: '0x5208',
                        },
                    }),
                })
                // Second call: eth_blockNumber
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: '0x110' }),
                })
                // Third call: eth_getBlockByNumber (reorg check)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: { hash: '0xabc' } }),
                });

            const provider = new PolygonProvider('https://polygon-rpc.com');
            const status = await provider.getTransactionStatus('0x123');

            expect(status.confirmations).toBe(17); // 0x110 - 0x100 + 1
            expect(status.reorged).toBe(false);
            expect(status.failed).toBe(false);
        });

        it('should detect failed transaction', async () => {
            global.fetch = vi.fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        result: {
                            blockNumber: '0x100',
                            blockHash: '0xabc',
                            status: '0x0', // Failed
                            gasUsed: '0x5208',
                        },
                    }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: '0x100' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: { hash: '0xabc' } }),
                });

            const provider = new PolygonProvider('https://polygon-rpc.com');
            const status = await provider.getTransactionStatus('0x123');

            expect(status.failed).toBe(true);
        });
    });

    describe('getGasPrice', () => {
        it('should return EIP-1559 gas prices', async () => {
            global.fetch = vi.fn()
                // eth_getBlockByNumber
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        result: { baseFeePerGas: '0x3b9aca00' }, // 1 gwei
                    }),
                })
                // eth_maxPriorityFeePerGas
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: '0x77359400' }), // 2 gwei
                });

            const provider = new PolygonProvider('https://polygon-rpc.com');
            const prices = await provider.getGasPrice();

            expect(prices.maxFeePerGas).toBeDefined();
            expect(prices.maxPriorityFeePerGas).toBeDefined();
        });
    });
});

describe('Anchor Service', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('anchorRecord (mock mode)', () => {
        it('should generate mock tx hash', async () => {
            const env = createMockEnv({ ANCHOR_MODE: 'mock' });

            const job: AnchorJob = {
                id: 'job-1',
                receiptId: 'receipt-1',
                createdAt: Date.now(),
                attempts: 0,
                chain: 'polygon',
            };

            const record: AttestRecord = {
                id: 'receipt-1',
                mode: 'pending',
                initiatorCommit: 'commit-abc',
                receivedAt: Date.now(),
                policyVersion: 'shield-v1',
            };

            const result = await anchorRecord(env, job, record);

            expect(result.ok).toBe(true);
            expect(result.txHash).toMatch(/^0xmock_[a-f0-9]+$/);
        });
    });

    describe('anchorBatch (mock mode)', () => {
        it('should batch multiple records', async () => {
            const env = createMockEnv({ ANCHOR_MODE: 'mock' });

            const records: AttestRecord[] = [
                {
                    id: 'r1',
                    mode: 'pending',
                    initiatorCommit: 'c1',
                    receivedAt: Date.now(),
                    policyVersion: 'v1',
                },
                {
                    id: 'r2',
                    mode: 'pending',
                    initiatorCommit: 'c2',
                    receivedAt: Date.now(),
                    policyVersion: 'v1',
                },
            ];

            const result = await anchorBatch(env, records);

            expect('txHash' in result).toBe(true);
            if ('txHash' in result) {
                expect(result.txHash).toMatch(/^0xmock_/);
                expect(result.merkleRoot).toBeDefined();
                expect(result.receiptIds).toEqual(['r1', 'r2']);
            }
        });

        it('should update records with Merkle proofs', async () => {
            const putMock = vi.fn();
            const env = createMockEnv({
                ANCHOR_MODE: 'mock',
                ATT_KV: { put: putMock, get: vi.fn() } as any,
            });

            const records: AttestRecord[] = [
                {
                    id: 'r1',
                    mode: 'pending',
                    initiatorCommit: 'c1',
                    receivedAt: Date.now(),
                    policyVersion: 'v1',
                },
            ];

            await anchorBatch(env, records);

            // Check that record was updated
            expect(records[0].mode).toBe('anchored');
            expect(records[0].txHash).toBeDefined();
            expect(records[0].final).toBeDefined();

            // Verify Merkle proof was stored
            const finalData = JSON.parse(records[0].final!);
            expect(finalData.merkleRoot).toBeDefined();
            expect(finalData.leafHash).toBeDefined();
        });

        it('should reject empty batch', async () => {
            const env = createMockEnv();
            const result = await anchorBatch(env, []);

            expect('ok' in result && !result.ok).toBe(true);
        });
    });

    describe('queryTransactionStatus', () => {
        it('should return confirmed for mock transactions', async () => {
            const env = createMockEnv({ ANCHOR_MODE: 'mock' });

            const status = await queryTransactionStatus(env, '0xmock_abc123');

            expect(status.confirmed).toBe(true);
            expect(status.confirmations).toBe(128);
        });

        it('should query blockchain for real transactions', async () => {
            global.fetch = vi.fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        result: {
                            blockNumber: '0x100',
                            blockHash: '0xabc',
                            status: '0x1',
                            gasUsed: '0x5208',
                        },
                    }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: '0x200' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ result: { hash: '0xabc' } }),
                });

            const env = createMockEnv({
                ANCHOR_MODE: 'direct',
                WEB3_RPC_URL_POLYGON: 'https://polygon-rpc.com',
            });

            const status = await queryTransactionStatus(env, '0xreal123', 'polygon');

            expect(status.confirmations).toBeGreaterThan(0);
        });
    });

    describe('direct mode', () => {
        it('should fail without RPC URL', async () => {
            const env = createMockEnv({
                ANCHOR_MODE: 'direct',
                WEB3_RPC_URL_POLYGON: undefined,
            });

            const job: AnchorJob = {
                id: 'job-1',
                receiptId: 'receipt-1',
                createdAt: Date.now(),
                attempts: 0,
                chain: 'polygon',
            };

            const record: AttestRecord = {
                id: 'receipt-1',
                mode: 'pending',
                initiatorCommit: 'commit-abc',
                receivedAt: Date.now(),
                policyVersion: 'shield-v1',
            };

            const result = await anchorRecord(env, job, record);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('No RPC URL');
        });

        it('should fail without private key', async () => {
            const env = createMockEnv({
                ANCHOR_MODE: 'direct',
                WEB3_RPC_URL_POLYGON: 'https://polygon-rpc.com',
                ANCHOR_PRIVATE_KEY: undefined,
            });

            const job: AnchorJob = {
                id: 'job-1',
                receiptId: 'receipt-1',
                createdAt: Date.now(),
                attempts: 0,
                chain: 'polygon',
            };

            const record: AttestRecord = {
                id: 'receipt-1',
                mode: 'pending',
                initiatorCommit: 'commit-abc',
                receivedAt: Date.now(),
                policyVersion: 'shield-v1',
            };

            const result = await anchorRecord(env, job, record);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('ANCHOR_PRIVATE_KEY');
        });
    });
});
