
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkFundsThreshold } from '../gatekeeper/funds/check';
import { getNativeBalance, getErc20Balance, rpcCall } from '../gatekeeper/funds/rpc';
import { getRpcEndpoint, resolveRpcEndpoint, CHAIN_CONFIGS } from '../gatekeeper/funds/providers';
import { Env } from '../types';

describe('Proof-of-Funds', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;
    let originalFetch: typeof fetch;

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
        };

        env = {
            TATTLEHASH_DB: mockDb,
            GATE_KV: mockKv,
            RPC_ETH_MAIN: 'https://eth-mainnet.example.com',
        } as any;

        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('checkFundsThreshold', () => {
        it('should return PASSED when balance >= threshold', async () => {
            // Mock successful RPC response with 1 ETH
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000', // 1 ETH in wei (10^18)
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '500000000000000000', // 0.5 ETH
            });

            expect(result.status).toBe('PASSED');
            expect(result.proof_type).toBe('OPAQUE_V1');
            expect(result.checked_at).toBeTypeOf('number');
        });

        it('should return FAILED when balance < threshold', async () => {
            // Mock RPC response with 0.1 ETH
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0x16345785d8a0000', // 0.1 ETH
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '1000000000000000000', // 1 ETH
            });

            expect(result.status).toBe('FAILED');
        });

        it('should check ERC20 balance correctly', async () => {
            // Mock ERC20 balance response
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0x000000000000000000000000000000000000000000000000000000003b9aca00', // 1 billion wei (1 USDC)
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'ERC20',
                token_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
                min_balance: '500000000', // 500 USDC (6 decimals)
            });

            expect(result.status).toBe('PASSED');
        });

        it('should throw VALIDATION_ERROR for ERC20 without token_address', async () => {
            await expect(
                checkFundsThreshold(env, {
                    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                    network: 'eth-mainnet',
                    asset_type: 'ERC20',
                    min_balance: '1000000',
                })
            ).rejects.toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        });

        it('should throw FUNDS_RPC_ERROR on RPC failure', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
            });

            await expect(
                checkFundsThreshold(env, {
                    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                    network: 'eth-mainnet',
                    asset_type: 'NATIVE',
                    min_balance: '1000000000000000000',
                })
            ).rejects.toMatchObject({
                code: 'FUNDS_RPC_ERROR',
            });
        });

        it('should cache result when challenge_id is provided', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000',
                    id: 1,
                }),
            });

            await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '500000000000000000',
                challenge_id: 'test-challenge-123',
            });

            expect(mockKv.put).toHaveBeenCalledWith(
                expect.stringMatching(/^funds_check:/),
                expect.any(String),
                expect.objectContaining({ expirationTtl: 3600 })
            );
        });

        it('should not cache result without challenge_id', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000',
                    id: 1,
                }),
            });

            await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '500000000000000000',
            });

            expect(mockKv.put).not.toHaveBeenCalled();
        });

        it('should not expose actual balance in response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000',
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '500000000000000000',
            });

            // Should not have balance field
            expect(result).not.toHaveProperty('balance');
            // Should have opaque proof type
            expect(result.proof_type).toBe('OPAQUE_V1');
        });
    });

    describe('RPC Functions', () => {
        beforeEach(() => {
            originalFetch = global.fetch;
        });

        afterEach(() => {
            global.fetch = originalFetch;
        });

        it('rpcCall should make valid JSON-RPC request', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0x123',
                    id: 1,
                }),
            });

            const result = await rpcCall('https://eth.example.com', 'eth_getBalance', ['0x123', 'latest']);

            expect(global.fetch).toHaveBeenCalledWith(
                'https://eth.example.com',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );
            expect(result).toBe('0x123');
        });

        it('rpcCall should throw on RPC error response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'execution reverted' },
                    id: 1,
                }),
            });

            await expect(
                rpcCall('https://eth.example.com', 'eth_call', [])
            ).rejects.toThrow('RPC error: execution reverted');
        });

        it('getNativeBalance should return BigInt', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000', // 1 ETH
                    id: 1,
                }),
            });

            const balance = await getNativeBalance('https://eth.example.com', '0x123');
            expect(typeof balance).toBe('bigint');
            expect(balance).toBe(1000000000000000000n);
        });

        it('getErc20Balance should construct correct call data', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0x0000000000000000000000000000000000000000000000000000000005f5e100',
                    id: 1,
                }),
            });

            const balance = await getErc20Balance(
                'https://eth.example.com',
                '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                '0x742d35Cc6634C0532925a3b844Bc9e7595F26911'
            );

            // Verify fetch was called with balanceOf selector (0x70a08231)
            const fetchCall = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);
            expect(body.params[0].data).toContain('70a08231');

            expect(typeof balance).toBe('bigint');
        });
    });

    describe('Provider Configuration', () => {
        it('should have configs for all supported networks', () => {
            expect(CHAIN_CONFIGS).toHaveProperty('eth-mainnet');
            expect(CHAIN_CONFIGS).toHaveProperty('base-mainnet');
            expect(CHAIN_CONFIGS).toHaveProperty('polygon-mainnet');
            expect(CHAIN_CONFIGS).toHaveProperty('arbitrum-one');
            expect(CHAIN_CONFIGS).toHaveProperty('optimism-mainnet');
        });

        it('resolveRpcEndpoint should replace env variables', () => {
            const env = { RPC_ETH_MAIN: 'https://my-rpc.com' };
            const resolved = resolveRpcEndpoint('${RPC_ETH_MAIN}', env);
            expect(resolved).toBe('https://my-rpc.com');
        });

        it('resolveRpcEndpoint should keep template when env var missing', () => {
            const resolved = resolveRpcEndpoint('${MISSING_VAR}', {});
            expect(resolved).toBe('${MISSING_VAR}');
        });

        it('getRpcEndpoint should use env var if available', () => {
            const env = { RPC_ETH_MAIN: 'https://custom-rpc.com' };
            const endpoint = getRpcEndpoint('eth-mainnet', env);
            expect(endpoint).toBe('https://custom-rpc.com');
        });

        it('getRpcEndpoint should fallback to public RPC', () => {
            const endpoint = getRpcEndpoint('eth-mainnet', {});
            expect(endpoint).toBe('https://cloudflare-eth.com');
        });

        it('getRpcEndpoint should throw for unsupported network', () => {
            expect(() => getRpcEndpoint('unsupported-chain', {})).toThrow('Unsupported network: unsupported-chain');
        });

        it('each chain config should have required fields', () => {
            for (const [network, config] of Object.entries(CHAIN_CONFIGS)) {
                expect(config).toHaveProperty('network', network);
                expect(config).toHaveProperty('chainId');
                expect(config).toHaveProperty('rpcEndpoints');
                expect(config.rpcEndpoints.length).toBeGreaterThan(0);
                expect(config).toHaveProperty('nativeCurrency');
                expect(config.nativeCurrency).toHaveProperty('symbol');
                expect(config.nativeCurrency).toHaveProperty('decimals');
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle zero balance', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0x0',
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '1',
            });

            expect(result.status).toBe('FAILED');
        });

        it('should handle exact threshold match', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xde0b6b3a7640000', // 1 ETH exactly
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '1000000000000000000', // Exactly 1 ETH
            });

            expect(result.status).toBe('PASSED'); // >= threshold
        });

        it('should handle very large balances', async () => {
            // 1 million ETH
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    jsonrpc: '2.0',
                    result: '0xd3c21bcecceda1000000', // 1,000,000 ETH
                    id: 1,
                }),
            });

            const result = await checkFundsThreshold(env, {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595F26911',
                network: 'eth-mainnet',
                asset_type: 'NATIVE',
                min_balance: '1000000000000000000',
            });

            expect(result.status).toBe('PASSED');
        });
    });
});
