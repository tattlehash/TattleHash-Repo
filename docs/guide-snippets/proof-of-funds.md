# Guide: Proof-of-Funds Verification

> Complete implementation of multi-chain balance threshold verification.  
> Privacy-preserving: counterparty sees only PASSED/FAILED, never actual balance.

---

## Overview

```
TattleHash                  RPC Provider                User
     │                           │                        │
     │   eth_getBalance()        │                        │
     │──────────────────────────>│                        │
     │                           │                        │
     │   balance: 5.2 ETH        │                        │
     │<──────────────────────────│                        │
     │                           │                        │
     │   balance >= threshold?   │                        │
     │   5.2 ETH >= 2 ETH ✓      │                        │
     │                           │                        │
     │   Store: balance_hash     │                        │
     │   Return: PASSED          │                        │
     │───────────────────────────────────────────────────>│
     │                           │                        │
     │   (actual balance never exposed to counterparty)   │
```

---

## File: `src/gatekeeper/funds/providers.ts`

```typescript
/**
 * RPC provider configuration for multi-chain balance queries.
 */

export interface ChainConfig {
  network: string;
  chainId: number;
  rpcEndpoints: string[];
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
  blockExplorer?: string;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'eth-mainnet': {
    network: 'eth-mainnet',
    chainId: 1,
    rpcEndpoints: [
      // Env var takes precedence, then fallbacks
      '${RPC_ETH_MAIN}',
      'https://cloudflare-eth.com',
      'https://eth.llamarpc.com',
    ],
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  'base-mainnet': {
    network: 'base-mainnet',
    chainId: 8453,
    rpcEndpoints: [
      '${RPC_BASE_MAIN}',
      'https://base-mainnet.public.blastapi.io',
      'https://base.llamarpc.com',
    ],
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  'polygon-mainnet': {
    network: 'polygon-mainnet',
    chainId: 137,
    rpcEndpoints: [
      '${WEB3_RPC_URL_POLYGON}',
      'https://polygon-rpc.com',
      'https://polygon.llamarpc.com',
    ],
    nativeCurrency: { symbol: 'MATIC', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
  'arbitrum-one': {
    network: 'arbitrum-one',
    chainId: 42161,
    rpcEndpoints: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.llamarpc.com',
    ],
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
  },
  'optimism-mainnet': {
    network: 'optimism-mainnet',
    chainId: 10,
    rpcEndpoints: [
      'https://mainnet.optimism.io',
      'https://optimism.llamarpc.com',
    ],
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  'bsc-mainnet': {
    network: 'bsc-mainnet',
    chainId: 56,
    rpcEndpoints: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
    ],
    nativeCurrency: { symbol: 'BNB', decimals: 18 },
    blockExplorer: 'https://bscscan.com',
  },
};

/**
 * Resolve RPC endpoint, substituting env vars.
 */
export function resolveRpcEndpoint(
  template: string,
  env: Record<string, string>
): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => env[key] || template);
}

/**
 * Get the best available RPC endpoint for a network.
 */
export function getRpcEndpoint(
  network: string,
  env: Record<string, string>
): string {
  const config = CHAIN_CONFIGS[network];
  if (!config) {
    throw new Error(`Unsupported network: ${network}`);
  }
  
  // Try env var first, then fallbacks
  for (const template of config.rpcEndpoints) {
    const resolved = resolveRpcEndpoint(template, env);
    if (!resolved.includes('${')) {
      return resolved;
    }
  }
  
  throw new Error(`No RPC endpoint available for ${network}`);
}
```

---

## File: `src/gatekeeper/funds/rpc.ts`

```typescript
/**
 * JSON-RPC client for balance queries.
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown[];
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: string;
  error?: { code: number; message: string };
  id: number;
}

let requestId = 1;

/**
 * Make a JSON-RPC call to an Ethereum node.
 */
export async function rpcCall(
  endpoint: string,
  method: string,
  params: unknown[]
): Promise<string> {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId++,
  };
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }
  
  const data: JsonRpcResponse = await response.json();
  
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  
  return data.result!;
}

/**
 * Get native token balance for an address.
 * Returns balance in wei as a BigInt.
 */
export async function getNativeBalance(
  endpoint: string,
  address: string
): Promise<bigint> {
  const result = await rpcCall(endpoint, 'eth_getBalance', [address, 'latest']);
  return BigInt(result);
}

/**
 * Get ERC-20 token balance for an address.
 * Returns balance in smallest units as a BigInt.
 */
export async function getErc20Balance(
  endpoint: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  // ERC-20 balanceOf(address) selector: 0x70a08231
  const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
  
  const result = await rpcCall(endpoint, 'eth_call', [
    { to: tokenAddress, data },
    'latest',
  ]);
  
  return BigInt(result);
}
```

---

## File: `src/gatekeeper/funds/check.ts`

```typescript
import { generateId, now } from '../../db';
import { execute } from '../../db';
import { getRpcEndpoint, CHAIN_CONFIGS } from './providers';
import { getNativeBalance, getErc20Balance } from './rpc';
import { sha256 } from '../../utils/crypto';
import type { Env } from '../../types';
import type { FundsCheckRequest, FundsCheckResponse } from './types';

/**
 * Check if a wallet meets the minimum balance threshold.
 * Privacy-preserving: actual balance is hashed, not stored or returned.
 */
export async function checkFundsThreshold(
  env: Env,
  data: FundsCheckRequest
): Promise<FundsCheckResponse> {
  const id = generateId();
  const checkedAt = now();
  
  // Get RPC endpoint for the network
  const endpoint = getRpcEndpoint(data.network, env as any);
  const provider = new URL(endpoint).hostname;
  
  // Fetch balance based on asset type
  let balance: bigint;
  try {
    if (data.asset_type === 'NATIVE') {
      balance = await getNativeBalance(endpoint, data.wallet_address);
    } else if (data.asset_type === 'ERC20') {
      if (!data.token_address) {
        throw { code: 'FUNDS_TOKEN_ADDRESS_REQUIRED' };
      }
      balance = await getErc20Balance(
        endpoint,
        data.token_address,
        data.wallet_address
      );
    } else {
      throw { code: 'FUNDS_UNSUPPORTED_NETWORK' };
    }
  } catch (e: any) {
    if (e.code) throw e;
    console.error('RPC error:', e);
    throw { code: 'FUNDS_RPC_ERROR', details: { message: e.message } };
  }
  
  // Compare against threshold
  const threshold = BigInt(data.min_balance);
  const passed = balance >= threshold;
  const status = passed ? 'PASSED' : 'FAILED';
  
  // Create privacy-preserving balance hash
  // Salt ensures the hash can't be rainbow-tabled
  const salt = crypto.randomUUID();
  const balanceHashInput = `${balance.toString()}:${salt}`;
  const balanceHashBytes = await sha256(balanceHashInput);
  const balanceHash = Array.from(balanceHashBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Store attestation if linked to a challenge
  if (data.challenge_id && data.user_id) {
    // First, create funds_requirement if it doesn't exist
    const requirementId = generateId();
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO funds_requirements (
        id, challenge_id, user_id, wallet_address, network,
        asset_type, token_address, min_balance, currency_symbol, snapshot_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requirementId,
        data.challenge_id,
        data.user_id,
        data.wallet_address.toLowerCase(),
        data.network,
        data.asset_type,
        data.token_address ?? null,
        data.min_balance,
        CHAIN_CONFIGS[data.network]?.nativeCurrency.symbol ?? 'UNKNOWN',
        'AT_INTENT_LOCK',
      ]
    );
    
    // Then create the attestation
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO funds_attestations (
        id, funds_requirement_id, balance_hash, status,
        checked_at, check_phase, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        requirementId,
        balanceHash,
        status,
        checkedAt,
        'INTENT_LOCK',
        provider,
      ]
    );
    
    // Create ZK proof record (opaque v1)
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO zk_proofs (
        id, funds_attestation_id, proof_type, proof_payload, status
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        generateId(),
        id,
        'OPAQUE_V1',
        JSON.stringify({
          balance_hash: balanceHash,
          min_balance: data.min_balance,
          comparison: 'gte',
          network: data.network,
          asset_type: data.asset_type,
        }),
        'VALID',
      ]
    );
  }
  
  // Return result without exposing actual balance
  return {
    status,
    proof_type: 'OPAQUE_V1',
    provider,
    checked_at: checkedAt,
  };
}
```

---

## File: `src/gatekeeper/funds/tokens.ts`

```typescript
/**
 * Common token addresses for ERC-20 verification.
 */

export interface TokenInfo {
  symbol: string;
  decimals: number;
  addresses: Record<string, string>; // network -> address
}

export const COMMON_TOKENS: Record<string, TokenInfo> = {
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    addresses: {
      'eth-mainnet': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'polygon-mainnet': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      'arbitrum-one': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      'optimism-mainnet': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      'base-mainnet': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  },
  USDT: {
    symbol: 'USDT',
    decimals: 6,
    addresses: {
      'eth-mainnet': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'polygon-mainnet': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      'arbitrum-one': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      'optimism-mainnet': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      'bsc-mainnet': '0x55d398326f99059fF775485246999027B3197955',
    },
  },
  DAI: {
    symbol: 'DAI',
    decimals: 18,
    addresses: {
      'eth-mainnet': '0x6B175474E89094C44Da98b954EescdeCB5f8e3',
      'polygon-mainnet': '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      'arbitrum-one': '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      'optimism-mainnet': '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
  WETH: {
    symbol: 'WETH',
    decimals: 18,
    addresses: {
      'eth-mainnet': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      'polygon-mainnet': '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      'arbitrum-one': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      'optimism-mainnet': '0x4200000000000000000000000000000000000006',
      'base-mainnet': '0x4200000000000000000000000000000000000006',
    },
  },
};

/**
 * Get token address for a symbol on a network.
 */
export function getTokenAddress(
  symbol: string,
  network: string
): string | null {
  const token = COMMON_TOKENS[symbol.toUpperCase()];
  if (!token) return null;
  return token.addresses[network] ?? null;
}

/**
 * Get token decimals for a symbol.
 */
export function getTokenDecimals(symbol: string): number {
  const token = COMMON_TOKENS[symbol.toUpperCase()];
  return token?.decimals ?? 18;
}

/**
 * Format balance from smallest units to human-readable.
 */
export function formatBalance(
  balance: bigint,
  decimals: number,
  maxDecimals: number = 4
): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const remainder = balance % divisor;
  
  if (remainder === 0n) {
    return whole.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmed = remainderStr.slice(0, maxDecimals).replace(/0+$/, '');
  
  if (!trimmed) {
    return whole.toString();
  }
  
  return `${whole}.${trimmed}`;
}
```

---

## Handler Integration

```typescript
// src/handlers/gatekeeper.ts (add to existing)

import { checkFundsThreshold } from '../gatekeeper/funds/check';
import { FundsCheckRequestSchema } from '../gatekeeper/funds/schemas';

export async function postFundsCheck(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const data = await parseBody(request, FundsCheckRequestSchema);
    const result = await checkFundsThreshold(env, data);
    return ok(result);
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Funds check error:', e);
    return createError('INTERNAL_ERROR');
  }
}
```

---

## Integration with Existing v1 Code

Your existing `src/utils/chains.js` has `getNativeBalance` and `meetsThreshold`. The v2 module extends this with:

1. **Multi-chain support** — Not just ETH mainnet
2. **ERC-20 support** — Any token, not just native
3. **Privacy preservation** — Balance hashed, never exposed
4. **D1 storage** — Attestations stored for challenge linking

You can reuse your existing functions by importing them:

```typescript
// In v2 code, for compatibility:
import { getNativeBalance as v1GetBalance } from '../../utils/chains';
```

---

## Tests

```typescript
// test/funds-verification.spec.ts

import { describe, it, expect, vi } from 'vitest';
import { checkFundsThreshold } from '../src/gatekeeper/funds/check';

describe('Funds Verification', () => {
  const mockEnv = {
    TATTLEHASH_DB: createMockD1(),
    RPC_ETH_MAIN: 'https://cloudflare-eth.com',
  };
  
  it('returns PASSED when balance meets threshold', async () => {
    // Mock RPC to return 5 ETH
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0x4563918244f40000', // 5 ETH in wei
        id: 1,
      }),
    } as Response);
    
    const result = await checkFundsThreshold(mockEnv, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '2000000000000000000', // 2 ETH
    });
    
    expect(result.status).toBe('PASSED');
    expect(result.proof_type).toBe('OPAQUE_V1');
  });
  
  it('returns FAILED when balance below threshold', async () => {
    // Mock RPC to return 1 ETH
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0xde0b6b3a7640000', // 1 ETH in wei
        id: 1,
      }),
    } as Response);
    
    const result = await checkFundsThreshold(mockEnv, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '2000000000000000000', // 2 ETH
    });
    
    expect(result.status).toBe('FAILED');
  });
  
  it('never exposes actual balance in response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: '0x4563918244f40000',
        id: 1,
      }),
    } as Response);
    
    const result = await checkFundsThreshold(mockEnv, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '1000000000000000000',
    });
    
    // Result should not contain any balance information
    expect(result).not.toHaveProperty('balance');
    expect(result).not.toHaveProperty('observed_balance');
    expect(JSON.stringify(result)).not.toContain('4563918244f40000');
  });
});
```
