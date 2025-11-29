
import { describe, it, expect, beforeEach } from 'vitest';
import { createWalletChallenge } from '../src/gatekeeper/wallet/challenge';
import { verifyWalletSignature } from '../src/gatekeeper/wallet/verify';

describe('Wallet Verification', () => {
    describe('createWalletChallenge', () => {
        it('creates challenge with valid nonce and expiry', async ({ env }) => {
            const result = await createWalletChallenge(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
                chain_id: 'eip155:1',
            });

            expect(result.challenge_id).toBeDefined();
            expect(result.message).toContain('TattleHash Wallet Verification');
            expect(result.message).toContain('0x742d35cc6634c0532925a3b844bc9e7595f8fe00');
            expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
        });

        it('normalizes wallet address to lowercase', async ({ env }) => {
            const result = await createWalletChallenge(env, {
                wallet_address: '0x742D35CC6634C0532925A3B844BC9E7595F8FE00',
                chain_id: 'eip155:1',
            });

            expect(result.message).toContain('0x742d35cc6634c0532925a3b844bc9e7595f8fe00');
        });
    });

    describe('verifyWalletSignature', () => {
        it('rejects non-existent challenge', async ({ env }) => {
            await expect(verifyWalletSignature(env, {
                challenge_id: 'non-existent-id',
                signature: '0x' + '0'.repeat(130),
            })).rejects.toThrow();
        });
    });
});
