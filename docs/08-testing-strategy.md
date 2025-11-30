# Testing Strategy

> Comprehensive testing approach for TattleHash Gatekeeper v2.  
> Every phase must pass its test gate before proceeding.

---

## Testing Pyramid

```
                    ┌─────────────┐
                    │   E2E (5%)  │  Full user flows
                    ├─────────────┤
                 ┌──┴─────────────┴──┐
                 │ Integration (25%) │  Module boundaries
                 ├───────────────────┤
        ┌────────┴───────────────────┴────────┐
        │           Unit Tests (70%)          │  Pure functions
        └─────────────────────────────────────┘
```

**Philosophy:** Test the boundaries heavily, trust the glue.

---

## Test Environment Setup

### Prerequisites

```bash
# Install dependencies
npm install

# Install test dependencies (if not in package.json)
npm install -D vitest @vitest/coverage-v8 msw

# Create local D1 database
wrangler d1 create tattlehash-db-test --local

# Run migrations
wrangler d1 execute tattlehash-db-test --local --file=db/migrations/001_initial.sql
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'miniflare',
    environmentOptions: {
      modules: true,
      kvNamespaces: ['GATE_KV', 'TATTLEHASH_KV'],
      d1Databases: ['TATTLEHASH_DB'],
    },
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        'src/worker.js', // Entry point, tested via integration
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    setupFiles: ['./test/setup.ts'],
  },
});
```

### test/setup.ts

```typescript
import { beforeAll, afterAll, afterEach } from 'vitest';

// Global test setup
beforeAll(async () => {
  // Initialize test database
  console.log('Test suite starting...');
});

afterAll(async () => {
  // Cleanup
  console.log('Test suite complete.');
});

afterEach(async () => {
  // Reset mocks between tests
  vi.clearAllMocks();
});
```

---

## Mock Factories

### test/mocks/env.ts

```typescript
import { vi } from 'vitest';
import type { Env } from '../../src/types';

/**
 * Create a mock environment for testing.
 */
export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    // KV Namespaces
    GATE_KV: createMockKV(),
    TATTLEHASH_KV: createMockKV(),
    TATTLEHASH_CONTENT_KV: createMockKV(),
    TATTLEHASH_ANCHOR_KV: createMockKV(),
    TATTLEHASH_ERROR_KV: createMockKV(),
    ATT_KV: createMockKV(),
    SHIELD_KV: createMockKV(),
    
    // D1 Database
    TATTLEHASH_DB: createMockD1(),
    
    // Queue
    TATTLEHASH_QUEUE: createMockQueue(),
    
    // Environment variables
    NODE_ENV: 'test',
    HMAC_SECRET: 'test-hmac-secret-min-32-chars-long',
    TATTLEHASH_BRAND_NAME: 'TattleHash',
    ANCHOR_MODE: 'queue',
    
    // RPC endpoints
    RPC_ETH_MAIN: 'https://mock-eth-rpc.test',
    RPC_BASE_MAIN: 'https://mock-base-rpc.test',
    WEB3_RPC_URL_POLYGON: 'https://mock-polygon-rpc.test',
    
    // Feature flags (enabled for tests)
    FF_GATEKEEPER_V2: 'true',
    FF_CHALLENGES: 'true',
    FF_FIRE_MODE: 'true',
    FF_ENFORCED_MODE: 'true',
    FF_WEBHOOKS: 'true',
    
    // Stripe (test mode)
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_FAKE: 'true',
    
    ...overrides,
  };
}

/**
 * Create a mock KV namespace.
 */
export function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  
  return {
    get: vi.fn(async (key: string, options?: any) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (options?.type === 'json') return JSON.parse(entry.value);
      return entry.value;
    }),
    
    put: vi.fn(async (key: string, value: string, options?: any) => {
      store.set(key, { value, metadata: options?.metadata });
    }),
    
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    
    list: vi.fn(async (options?: any) => {
      const keys = Array.from(store.keys())
        .filter(k => !options?.prefix || k.startsWith(options.prefix))
        .slice(0, options?.limit || 1000)
        .map(name => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    }),
    
    getWithMetadata: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: entry.value, metadata: entry.metadata };
    }),
  } as unknown as KVNamespace;
}

/**
 * Create a mock D1 database.
 */
export function createMockD1(): D1Database {
  const tables = new Map<string, any[]>();
  
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: any[]) => ({
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
        all: vi.fn(async () => ({ results: [], success: true })),
        first: vi.fn(async () => null),
        raw: vi.fn(async () => []),
      })),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      all: vi.fn(async () => ({ results: [], success: true })),
      first: vi.fn(async () => null),
    })),
    
    dump: vi.fn(async () => new ArrayBuffer(0)),
    
    batch: vi.fn(async (statements: any[]) => 
      statements.map(() => ({ success: true, results: [] }))
    ),
    
    exec: vi.fn(async (sql: string) => ({ count: 1, duration: 0 })),
  } as unknown as D1Database;
}

/**
 * Create a mock Queue.
 */
export function createMockQueue(): Queue {
  const messages: any[] = [];
  
  return {
    send: vi.fn(async (message: any) => {
      messages.push(message);
    }),
    sendBatch: vi.fn(async (batch: any[]) => {
      messages.push(...batch.map(b => b.body));
    }),
  } as unknown as Queue;
}
```

### test/mocks/rpc.ts

```typescript
import { vi } from 'vitest';

/**
 * Mock RPC responses for balance checks.
 */
export const mockRpcResponses = {
  // 5 ETH in wei
  balanceHigh: '0x4563918244f40000',
  // 1 ETH in wei  
  balanceLow: '0xde0b6b3a7640000',
  // 0 ETH
  balanceZero: '0x0',
  // 1000 USDC (6 decimals)
  usdcBalance: '0x3b9aca00',
};

/**
 * Create a mock fetch for RPC calls.
 */
export function mockRpcFetch(balance: string = mockRpcResponses.balanceHigh) {
  return vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    
    // eth_getBalance
    if (body.method === 'eth_getBalance') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: balance,
      }));
    }
    
    // eth_call (ERC-20 balanceOf)
    if (body.method === 'eth_call') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: '0x' + balance.slice(2).padStart(64, '0'),
      }));
    }
    
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    }));
  });
}

/**
 * Mock RPC failure.
 */
export function mockRpcFailure(errorMessage: string = 'RPC unavailable') {
  return vi.fn(async () => {
    throw new Error(errorMessage);
  });
}
```

### test/mocks/crypto.ts

```typescript
import { vi } from 'vitest';

/**
 * Mock wallet address and signature pairs for testing.
 * These are deterministic test vectors.
 */
export const testWallets = {
  alice: {
    address: '0x742d35cc6634c0532925a3b844bc9e7595f8fe00',
    // Pre-computed signature for test message
    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b',
  },
  bob: {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901c',
  },
  // Invalid address for negative tests
  invalid: {
    address: '0xinvalid',
    signature: '0xbad',
  },
};

/**
 * Mock signature recovery to return expected address.
 */
export function mockSignatureRecovery(expectedAddress: string) {
  return vi.fn(async (message: string, signature: string) => {
    // Return the expected address for valid-looking signatures
    if (signature.length === 132 && signature.startsWith('0x')) {
      return expectedAddress;
    }
    throw new Error('Invalid signature');
  });
}
```

---

## Unit Tests

### test/unit/errors.spec.ts

```typescript
import { describe, it, expect } from 'vitest';
import { ERRORS, createError } from '../../src/errors';

describe('Error Taxonomy', () => {
  it('all error codes are unique', () => {
    const codes = Object.values(ERRORS).map(e => e.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });
  
  it('all error codes follow naming convention', () => {
    Object.entries(ERRORS).forEach(([key, error]) => {
      expect(error.code).toMatch(/^E\d{4}$/);
    });
  });
  
  it('createError returns proper Response', async () => {
    const response = createError('WALLET_INVALID_ADDRESS', { 
      provided: '0xinvalid' 
    });
    
    expect(response.status).toBe(400);
    
    const body = await response.json();
    expect(body.error.code).toBe('E1001');
    expect(body.error.details.provided).toBe('0xinvalid');
  });
});
```

### test/unit/validation.spec.ts

```typescript
import { describe, it, expect } from 'vitest';
import { 
  EthAddressSchema,
  ChainIdSchema,
  WalletChallengeRequestSchema,
  FundsCheckRequestSchema,
  CreateChallengeRequestSchema,
} from '../../src/schemas';

describe('Zod Schemas', () => {
  describe('EthAddressSchema', () => {
    it('accepts valid checksummed address', () => {
      const result = EthAddressSchema.safeParse(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00'
      );
      expect(result.success).toBe(true);
      // Should lowercase
      expect(result.data).toBe('0x742d35cc6634c0532925a3b844bc9e7595f8fe00');
    });
    
    it('rejects invalid address', () => {
      const result = EthAddressSchema.safeParse('0xinvalid');
      expect(result.success).toBe(false);
    });
    
    it('rejects address without 0x prefix', () => {
      const result = EthAddressSchema.safeParse(
        '742d35Cc6634C0532925a3b844Bc9e7595f8fE00'
      );
      expect(result.success).toBe(false);
    });
  });
  
  describe('ChainIdSchema', () => {
    it('accepts EIP-155 format', () => {
      expect(ChainIdSchema.safeParse('eip155:1').success).toBe(true);
      expect(ChainIdSchema.safeParse('eip155:137').success).toBe(true);
    });
    
    it('accepts Solana format', () => {
      expect(ChainIdSchema.safeParse('solana-mainnet').success).toBe(true);
    });
    
    it('rejects invalid format', () => {
      expect(ChainIdSchema.safeParse('ethereum').success).toBe(false);
      expect(ChainIdSchema.safeParse('1').success).toBe(false);
    });
  });
  
  describe('FundsCheckRequestSchema', () => {
    it('requires token_address for ERC20', () => {
      const result = FundsCheckRequestSchema.safeParse({
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
        network: 'eth-mainnet',
        asset_type: 'ERC20',
        min_balance: '1000000',
        // Missing token_address
      });
      expect(result.success).toBe(false);
    });
    
    it('accepts NATIVE without token_address', () => {
      const result = FundsCheckRequestSchema.safeParse({
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
        network: 'eth-mainnet',
        asset_type: 'NATIVE',
        min_balance: '1000000000000000000',
      });
      expect(result.success).toBe(true);
    });
  });
  
  describe('CreateChallengeRequestSchema', () => {
    it('rejects SOLO with counterparty', () => {
      const result = CreateChallengeRequestSchema.safeParse({
        mode: 'SOLO',
        title: 'Test',
        counterparty_user_id: 'some-id', // Not allowed for SOLO
      });
      expect(result.success).toBe(false);
    });
    
    it('requires fire_config for FIRE mode', () => {
      const result = CreateChallengeRequestSchema.safeParse({
        mode: 'FIRE',
        title: 'Test',
        counterparty_user_id: 'some-id',
        // Missing fire_config
      });
      expect(result.success).toBe(false);
    });
  });
});
```

### test/unit/state-machines.spec.ts

```typescript
import { describe, it, expect } from 'vitest';
import { 
  canTransition,
  isTerminalStatus,
  requiresCounterparty,
} from '../../src/modes/transitions';

describe('State Machines', () => {
  describe('Solo Mode Transitions', () => {
    it('allows DRAFT -> INTENT_LOCKED', () => {
      expect(canTransition('SOLO', 'DRAFT', 'INTENT_LOCKED')).toBe(true);
    });
    
    it('allows DRAFT -> CANCELLED', () => {
      expect(canTransition('SOLO', 'DRAFT', 'CANCELLED')).toBe(true);
    });
    
    it('prevents COMPLETED -> DRAFT', () => {
      expect(canTransition('SOLO', 'COMPLETED', 'DRAFT')).toBe(false);
    });
    
    it('prevents CANCELLED -> anything', () => {
      expect(canTransition('SOLO', 'CANCELLED', 'DRAFT')).toBe(false);
      expect(canTransition('SOLO', 'CANCELLED', 'COMPLETED')).toBe(false);
    });
  });
  
  describe('Gatekeeper Mode Transitions', () => {
    it('allows DRAFT -> AWAITING_COUNTERPARTY', () => {
      expect(canTransition('GATEKEEPER', 'DRAFT', 'AWAITING_COUNTERPARTY')).toBe(true);
    });
    
    it('allows AWAITING_COUNTERPARTY -> AWAITING_GATEKEEPER', () => {
      expect(canTransition('GATEKEEPER', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER')).toBe(true);
    });
    
    it('allows AWAITING_GATEKEEPER -> INTENT_LOCKED', () => {
      expect(canTransition('GATEKEEPER', 'AWAITING_GATEKEEPER', 'INTENT_LOCKED')).toBe(true);
    });
    
    it('prevents skipping AWAITING_GATEKEEPER', () => {
      expect(canTransition('GATEKEEPER', 'AWAITING_COUNTERPARTY', 'INTENT_LOCKED')).toBe(false);
    });
  });
  
  describe('Terminal Status', () => {
    it('identifies terminal statuses', () => {
      expect(isTerminalStatus('COMPLETED')).toBe(true);
      expect(isTerminalStatus('CANCELLED')).toBe(true);
      expect(isTerminalStatus('EXPIRED')).toBe(true);
    });
    
    it('identifies non-terminal statuses', () => {
      expect(isTerminalStatus('DRAFT')).toBe(false);
      expect(isTerminalStatus('INTENT_LOCKED')).toBe(false);
      expect(isTerminalStatus('DISPUTED')).toBe(false);
    });
  });
  
  describe('Mode Requirements', () => {
    it('SOLO does not require counterparty', () => {
      expect(requiresCounterparty('SOLO')).toBe(false);
    });
    
    it('other modes require counterparty', () => {
      expect(requiresCounterparty('GATEKEEPER')).toBe(true);
      expect(requiresCounterparty('FIRE')).toBe(true);
      expect(requiresCounterparty('ENFORCED')).toBe(true);
    });
  });
});
```

### test/unit/funds-threshold.spec.ts

```typescript
import { describe, it, expect } from 'vitest';

describe('Funds Threshold Logic', () => {
  // Pure function tests - no mocking needed
  
  function meetsThreshold(balance: bigint, threshold: bigint): boolean {
    return balance >= threshold;
  }
  
  it('passes when balance equals threshold', () => {
    const balance = BigInt('1000000000000000000'); // 1 ETH
    const threshold = BigInt('1000000000000000000'); // 1 ETH
    expect(meetsThreshold(balance, threshold)).toBe(true);
  });
  
  it('passes when balance exceeds threshold', () => {
    const balance = BigInt('5000000000000000000'); // 5 ETH
    const threshold = BigInt('1000000000000000000'); // 1 ETH
    expect(meetsThreshold(balance, threshold)).toBe(true);
  });
  
  it('fails when balance below threshold', () => {
    const balance = BigInt('500000000000000000'); // 0.5 ETH
    const threshold = BigInt('1000000000000000000'); // 1 ETH
    expect(meetsThreshold(balance, threshold)).toBe(false);
  });
  
  it('handles zero balance', () => {
    const balance = BigInt('0');
    const threshold = BigInt('1');
    expect(meetsThreshold(balance, threshold)).toBe(false);
  });
  
  it('handles zero threshold', () => {
    const balance = BigInt('0');
    const threshold = BigInt('0');
    expect(meetsThreshold(balance, threshold)).toBe(true);
  });
  
  it('handles very large numbers', () => {
    const balance = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
    const threshold = BigInt('1000000000000000000');
    expect(meetsThreshold(balance, threshold)).toBe(true);
  });
});
```

---

## Integration Tests

### test/integration/wallet-verification.spec.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnv, createMockKV } from '../mocks/env';
import { testWallets, mockSignatureRecovery } from '../mocks/crypto';
import { createWalletChallenge } from '../../src/gatekeeper/wallet/challenge';
import { verifyWalletSignature } from '../../src/gatekeeper/wallet/verify';

describe('Wallet Verification Flow', () => {
  let env: ReturnType<typeof createMockEnv>;
  
  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });
  
  it('creates challenge with valid nonce and expiry', async () => {
    const result = await createWalletChallenge(env, {
      wallet_address: testWallets.alice.address,
      chain_id: 'eip155:1',
    });
    
    expect(result.challenge_id).toBeDefined();
    expect(result.message).toContain('TattleHash Wallet Verification');
    expect(result.message).toContain(testWallets.alice.address);
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
  
  it('normalizes address to lowercase', async () => {
    const mixedCase = '0x742D35Cc6634C0532925A3B844Bc9e7595F8fE00';
    
    const result = await createWalletChallenge(env, {
      wallet_address: mixedCase,
      chain_id: 'eip155:1',
    });
    
    expect(result.message).toContain(mixedCase.toLowerCase());
  });
  
  it('stores challenge in KV with TTL', async () => {
    await createWalletChallenge(env, {
      wallet_address: testWallets.alice.address,
      chain_id: 'eip155:1',
    });
    
    expect(env.GATE_KV.put).toHaveBeenCalledWith(
      expect.stringMatching(/^nonce:/),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });
  
  // Note: Full signature verification requires actual crypto
  // For integration tests, we mock the recovery function
  it('rejects mismatched address after recovery', async () => {
    // Setup: Create challenge for Alice
    const challenge = await createWalletChallenge(env, {
      wallet_address: testWallets.alice.address,
      chain_id: 'eip155:1',
    });
    
    // Mock D1 to return the challenge
    env.TATTLEHASH_DB.prepare = vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          id: challenge.challenge_id,
          wallet_address: testWallets.alice.address,
          message: challenge.message,
          status: 'PENDING',
          expires_at: challenge.expires_at,
          challenge_nonce: 'test-nonce',
        })),
      })),
    })) as any;
    
    // Attempt verify with Bob's signature (would recover to Bob's address)
    // This should fail because recovered address != challenge address
    await expect(
      verifyWalletSignature(env, {
        challenge_id: challenge.challenge_id,
        signature: testWallets.bob.signature,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/WALLET_/) });
  });
});
```

### test/integration/funds-check.spec.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnv } from '../mocks/env';
import { mockRpcFetch, mockRpcResponses, mockRpcFailure } from '../mocks/rpc';
import { checkFundsThreshold } from '../../src/gatekeeper/funds/check';

describe('Funds Check Flow', () => {
  let env: ReturnType<typeof createMockEnv>;
  
  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });
  
  it('returns PASSED when balance exceeds threshold', async () => {
    // Mock RPC to return 5 ETH
    global.fetch = mockRpcFetch(mockRpcResponses.balanceHigh);
    
    const result = await checkFundsThreshold(env, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '1000000000000000000', // 1 ETH
    });
    
    expect(result.status).toBe('PASSED');
    expect(result.proof_type).toBe('OPAQUE_V1');
  });
  
  it('returns FAILED when balance below threshold', async () => {
    // Mock RPC to return 1 ETH
    global.fetch = mockRpcFetch(mockRpcResponses.balanceLow);
    
    const result = await checkFundsThreshold(env, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '2000000000000000000', // 2 ETH
    });
    
    expect(result.status).toBe('FAILED');
  });
  
  it('never exposes actual balance', async () => {
    global.fetch = mockRpcFetch(mockRpcResponses.balanceHigh);
    
    const result = await checkFundsThreshold(env, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'NATIVE',
      min_balance: '1000000000000000000',
    });
    
    // Result should not contain balance information
    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain('4563918244f40000');
    expect(resultString).not.toContain('balance');
  });
  
  it('handles RPC failure gracefully', async () => {
    global.fetch = mockRpcFailure('Connection refused');
    
    await expect(
      checkFundsThreshold(env, {
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
        network: 'eth-mainnet',
        asset_type: 'NATIVE',
        min_balance: '1000000000000000000',
      })
    ).rejects.toMatchObject({ code: 'FUNDS_RPC_ERROR' });
  });
  
  it('checks ERC-20 token balance', async () => {
    global.fetch = mockRpcFetch(mockRpcResponses.usdcBalance);
    
    const result = await checkFundsThreshold(env, {
      wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      network: 'eth-mainnet',
      asset_type: 'ERC20',
      token_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      min_balance: '500000000', // 500 USDC
    });
    
    expect(result.status).toBe('PASSED');
  });
});
```

### test/integration/challenge-lifecycle.spec.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnv } from '../mocks/env';

describe('Challenge Lifecycle', () => {
  let env: ReturnType<typeof createMockEnv>;
  
  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });
  
  describe('Solo Mode', () => {
    it('completes full lifecycle', async () => {
      // 1. Create challenge
      // 2. Confirm -> INTENT_LOCKED
      // 3. Complete -> COMPLETED
      // Each step should be valid
    });
  });
  
  describe('Gatekeeper Mode', () => {
    it('completes full lifecycle with both parties', async () => {
      // 1. Creator creates challenge
      // 2. Counterparty accepts -> AWAITING_GATEKEEPER
      // 3. Both verify wallets
      // 4. Both pass funds check
      // 5. Intent locks
      // 6. Both confirm -> COMPLETED
    });
    
    it('cancels if verification fails', async () => {
      // 1. Creator creates challenge
      // 2. Counterparty accepts
      // 3. Funds check fails for one party
      // 4. Status -> CANCELLED
    });
  });
});
```

---

## E2E Tests

### test/e2e/api.spec.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev } from 'wrangler';
import type { UnstableDevWorker } from 'wrangler';

describe('E2E API Tests', () => {
  let worker: UnstableDevWorker;
  
  beforeAll(async () => {
    worker = await unstable_dev('src/worker.js', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        FF_GATEKEEPER_V2: 'true',
        FF_CHALLENGES: 'true',
      },
    });
  });
  
  afterAll(async () => {
    await worker.stop();
  });
  
  it('health check returns 200', async () => {
    const resp = await worker.fetch('/health');
    expect(resp.status).toBe(200);
    
    const data = await resp.json();
    expect(data.status).toBe('ok');
  });
  
  it('wallet challenge endpoint works', async () => {
    const resp = await worker.fetch('/gatekeeper/v2/wallet/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
        chain_id: 'eip155:1',
      }),
    });
    
    expect(resp.status).toBe(201);
    
    const data = await resp.json();
    expect(data.challenge_id).toBeDefined();
    expect(data.message).toContain('TattleHash');
  });
  
  it('rejects invalid wallet address', async () => {
    const resp = await worker.fetch('/gatekeeper/v2/wallet/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: '0xinvalid',
        chain_id: 'eip155:1',
      }),
    });
    
    expect(resp.status).toBe(400);
    
    const data = await resp.json();
    expect(data.error.code).toBe('E1001');
  });
  
  it('returns 503 when feature flag disabled', async () => {
    // Start new worker with flag disabled
    const restrictedWorker = await unstable_dev('src/worker.js', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        FF_GATEKEEPER_V2: 'false',
      },
    });
    
    const resp = await restrictedWorker.fetch('/gatekeeper/v2/wallet/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
        chain_id: 'eip155:1',
      }),
    });
    
    expect(resp.status).toBe(503);
    
    await restrictedWorker.stop();
  });
});
```

---

## Manual Testing Checklist

### Phase 1: Foundation

```bash
# ✓ D1 migrations run
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql

# ✓ Worker starts
wrangler dev

# ✓ Health check
curl http://localhost:8787/health
# Expected: {"status":"ok","version":"4.5.0"}
```

### Phase 2: Wallet Verification

```bash
# ✓ Create challenge
curl -X POST http://localhost:8787/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", "chain_id": "eip155:1"}'
# Expected: {"challenge_id":"...","message":"...","expires_at":"..."}

# ✓ Invalid address rejected
curl -X POST http://localhost:8787/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0xinvalid", "chain_id": "eip155:1"}'
# Expected: 400 with E1001

# ✓ Verify with MetaMask (manual)
# 1. Copy message from challenge response
# 2. In browser console with MetaMask:
#    await ethereum.request({method: 'personal_sign', params: [message, address]})
# 3. Submit signature to /verify
```

### Phase 3: Funds Check

```bash
# ✓ Check known address with funds
curl -X POST http://localhost:8787/gatekeeper/v2/funds/check \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "network": "eth-mainnet",
    "asset_type": "NATIVE",
    "min_balance": "1000000000000000000"
  }'
# Expected: {"status":"PASSED","proof_type":"OPAQUE_V1",...}

# ✓ Balance not exposed
# Response should NOT contain actual balance value
```

### Phase 4+: Full Flow

```bash
# ✓ Create Gatekeeper challenge
# ✓ Accept as counterparty
# ✓ Both parties verify wallets
# ✓ Both parties pass funds check
# ✓ Intent locks
# ✓ Both confirm completion
# ✓ Shareable proof URL works
```

---

## Coverage Requirements

| Module | Required Coverage |
|--------|------------------|
| `src/errors.ts` | 100% |
| `src/modes/*.ts` | 90% |
| `src/gatekeeper/wallet/*.ts` | 85% |
| `src/gatekeeper/funds/*.ts` | 85% |
| `src/challenges/*.ts` | 80% |
| `src/db/*.ts` | 75% |
| Overall | 80% |

Run coverage:

```bash
npm run test:coverage
```

---

## CI Integration

Tests run automatically on:
- Every push to `main` or `develop`
- Every pull request to `main`

See `.github/workflows/test.yml` for configuration.

**PR Requirements:**
- All tests pass
- Coverage thresholds met
- No TypeScript errors
- No lint errors
