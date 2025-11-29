
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWalletChallenge } from '../gatekeeper/wallet/challenge';
import { verifyWalletSignature } from '../gatekeeper/wallet/verify';
import { recoverAddressFromSignature } from '../gatekeeper/wallet/recovery';
import { Env } from '../types';

describe('Wallet Verification', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;
    let mockQueue: any;

    beforeEach(() => {
        mockDb = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
        };
        mockKv = {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue({ keys: [] }),
        };
        mockQueue = {
            send: vi.fn(),
        };

        env = {
            TATTLEHASH_DB: mockDb,
            GATE_KV: mockKv,
            ATT_KV: mockKv,
            TATTLEHASH_QUEUE: mockQueue,
            TATTLEHASH_KV: mockKv,
            TATTLEHASH_CONTENT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
            TATTLEHASH_ERROR_KV: mockKv,
            SHIELD_KV: mockKv,
        };
    });

    describe('createWalletChallenge', () => {
        it('should create a challenge with valid parameters', async () => {
            const result = await createWalletChallenge(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                chain_id: 'eip155:1',
            });

            expect(result).toHaveProperty('challenge_id');
            expect(result).toHaveProperty('message');
            expect(result).toHaveProperty('expires_at');
            expect(result.message).toContain('TattleHash Wallet Verification');
            expect(result.message).toContain('0x742d35cc6634c0532925a3b844bc9e7595f26911'); // lowercase
            expect(result.message).toContain('eip155:1');
        });

        it('should normalize wallet address to lowercase', async () => {
            const result = await createWalletChallenge(env, {
                wallet_address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
                chain_id: 'eip155:1',
            });

            expect(result.message).toContain('0xabcdef1234567890abcdef1234567890abcdef12');
        });

        it('should store challenge in database', async () => {
            await createWalletChallenge(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                chain_id: 'eip155:1',
            });

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO wallet_challenges')
            );
        });

        it('should cache challenge in KV store', async () => {
            const result = await createWalletChallenge(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                chain_id: 'eip155:1',
            });

            expect(mockKv.put).toHaveBeenCalledWith(
                `wallet_challenge:${result.challenge_id}`,
                expect.any(String),
                expect.objectContaining({ expirationTtl: expect.any(Number) })
            );
        });

        it('should set expiry 10 minutes from now', async () => {
            const before = Date.now();
            const result = await createWalletChallenge(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                chain_id: 'eip155:1',
            });
            const after = Date.now();

            const expiresAt = new Date(result.expires_at).getTime();
            const expectedMin = before + 600 * 1000;
            const expectedMax = after + 600 * 1000;

            expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
            expect(expiresAt).toBeLessThanOrEqual(expectedMax);
        });
    });

    describe('verifyWalletSignature', () => {
        it('should throw WALLET_CHALLENGE_NOT_FOUND for missing challenge', async () => {
            mockKv.get.mockResolvedValue(null);

            await expect(
                verifyWalletSignature(env, {
                    challenge_id: 'nonexistent',
                    signature: '0x1234',
                })
            ).rejects.toMatchObject({
                code: 'WALLET_CHALLENGE_NOT_FOUND',
            });
        });

        it('should throw WALLET_CHALLENGE_EXPIRED for expired challenge', async () => {
            mockKv.get.mockResolvedValue(
                JSON.stringify({
                    wallet_address: '0x742d35cc6634c0532925a3b844bc9e7595f26911',
                    nonce: 'abc123',
                    message: 'Test message',
                    expires_at: Date.now() - 1000, // Already expired
                })
            );

            await expect(
                verifyWalletSignature(env, {
                    challenge_id: 'test-challenge',
                    signature: '0x1234',
                })
            ).rejects.toMatchObject({
                code: 'WALLET_CHALLENGE_EXPIRED',
            });
        });

        it('should throw WALLET_INVALID_SIGNATURE for invalid signature format', async () => {
            mockKv.get.mockResolvedValue(
                JSON.stringify({
                    wallet_address: '0x742d35cc6634c0532925a3b844bc9e7595f26911',
                    nonce: 'abc123',
                    message: 'Test message',
                    expires_at: Date.now() + 600000,
                })
            );

            await expect(
                verifyWalletSignature(env, {
                    challenge_id: 'test-challenge',
                    signature: 'invalid-signature',
                })
            ).rejects.toMatchObject({
                code: 'WALLET_INVALID_SIGNATURE',
            });
        });

        it('should throw WALLET_INVALID_SIGNATURE for wrong address', async () => {
            // This is a valid signature but for a different address
            const message = 'Test message';
            mockKv.get.mockResolvedValue(
                JSON.stringify({
                    wallet_address: '0x0000000000000000000000000000000000000001',
                    nonce: 'abc123',
                    message: message,
                    expires_at: Date.now() + 600000,
                })
            );

            // A valid-format signature (65 bytes = 130 hex chars)
            const fakeSignature = '0x' + 'a'.repeat(128) + '1b';

            await expect(
                verifyWalletSignature(env, {
                    challenge_id: 'test-challenge',
                    signature: fakeSignature,
                })
            ).rejects.toMatchObject({
                code: 'WALLET_INVALID_SIGNATURE',
            });
        });
    });

    describe('recoverAddressFromSignature', () => {
        it('should reject invalid signature length', async () => {
            await expect(
                recoverAddressFromSignature('Test message', '0x1234')
            ).rejects.toThrow('Invalid signature length');
        });

        it('should handle signature without 0x prefix', async () => {
            // Valid length but will fail recovery - tests prefix handling
            const sigWithoutPrefix = 'a'.repeat(130);
            await expect(
                recoverAddressFromSignature('Test message', sigWithoutPrefix)
            ).rejects.toThrow(); // Will throw during recovery
        });

        it('should handle legacy v values (0 and 1)', async () => {
            // Test that v values 0 and 1 are converted to 27 and 28
            // This is internal behavior - signature will be invalid but parsing should work
            const sigWithLowV = '0x' + 'a'.repeat(128) + '00'; // v = 0
            await expect(
                recoverAddressFromSignature('Test message', sigWithLowV)
            ).rejects.toThrow(); // Throws during actual recovery, not parsing
        });
    });
});

describe('Wallet Challenge Message Format', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;

    beforeEach(() => {
        mockDb = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            run: vi.fn().mockResolvedValue({ success: true }),
        };
        mockKv = {
            put: vi.fn().mockResolvedValue(undefined),
        };
        env = {
            TATTLEHASH_DB: mockDb,
            GATE_KV: mockKv,
        } as any;
    });

    it('should include all required fields in message', async () => {
        const result = await createWalletChallenge(env, {
            wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
            chain_id: 'eip155:137',
        });

        expect(result.message).toContain('Address:');
        expect(result.message).toContain('Chain:');
        expect(result.message).toContain('Nonce:');
        expect(result.message).toContain('Expires at:');
        expect(result.message).toContain('Purpose: gatekeeper_wallet_ownership');
    });

    it('should generate unique nonces for each challenge', async () => {
        const result1 = await createWalletChallenge(env, {
            wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
            chain_id: 'eip155:1',
        });

        const result2 = await createWalletChallenge(env, {
            wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
            chain_id: 'eip155:1',
        });

        // Extract nonces from messages
        const nonceRegex = /Nonce: ([a-f0-9]+)/;
        const nonce1 = result1.message.match(nonceRegex)?.[1];
        const nonce2 = result2.message.match(nonceRegex)?.[1];

        expect(nonce1).toBeDefined();
        expect(nonce2).toBeDefined();
        expect(nonce1).not.toBe(nonce2);
    });
});
