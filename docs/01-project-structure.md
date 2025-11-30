# Project Structure

> How files are organized in the TattleHash codebase.  
> New code follows this structure exactly.

---

## Current Structure (Existing)

```
tattlehash-worker/
├── src/
│   ├── worker.js              # Entry point (Cloudflare Worker)
│   ├── router.ts              # Route definitions
│   ├── types.ts               # Shared TypeScript types
│   │
│   ├── gatekeeper.js          # v1 Gatekeeper (DO NOT MODIFY)
│   ├── hashing.js             # Commitment hashing utilities
│   ├── anchor.js              # Async anchoring logic
│   ├── shield.js              # Request protection/gating
│   ├── debug.js               # Debug helpers
│   │
│   ├── handlers/
│   │   ├── attest.ts          # POST /attest
│   │   ├── health.ts          # GET /health
│   │   ├── receipt.ts         # GET /receipt/:id
│   │   └── sweep.ts           # POST /admin/sweep
│   │
│   ├── jobs/
│   │   └── queue.ts           # Background job helpers
│   │
│   ├── lib/
│   │   ├── http.ts            # ok(), err() response helpers
│   │   ├── kv.ts              # KV utilities
│   │   ├── ids.ts             # ID generation
│   │   └── locks.ts           # Distributed locking
│   │
│   ├── models/
│   │   └── receipt.ts         # Receipt data model
│   │
│   ├── utils/
│   │   ├── chains.js          # Balance checking, chain utils
│   │   ├── stripe.js          # Stripe payment helpers
│   │   ├── hmac.js            # HMAC signing utilities
│   │   └── dev.js             # Development helpers
│   │
│   └── tests/
│       └── harness.ts         # Test harness utilities
│
├── test/
│   ├── index.spec.ts          # Main test suite
│   ├── env.d.ts               # Test environment types
│   └── tsconfig.json          # Test TS config
│
├── public/                     # Static assets (if any)
│
├── wrangler.toml              # Cloudflare Worker config
├── wrangler.jsonc.jsonc       # Additional wrangler config
├── worker-configuration.d.ts  # Worker environment types
├── package.json
├── package-lock.json
├── tsconfig.json
└── vitest.config.mts
```

---

## New Structure (After Build Spec Implementation)

```
tattlehash-worker/
├── src/
│   ├── worker.js              # Entry point (unchanged)
│   ├── router.ts              # Extended with new routes
│   ├── types.ts               # Extended with new types
│   ├── errors.ts              # NEW: Error taxonomy
│   │
│   ├── gatekeeper.js          # v1 (unchanged)
│   ├── hashing.js             # (unchanged, reused)
│   ├── anchor.js              # (unchanged, reused)
│   ├── shield.js              # (unchanged)
│   ├── debug.js               # (unchanged)
│   │
│   │   ══════════════════════════════════════════
│   │   NEW: GATEKEEPER V2 MODULE
│   │   ══════════════════════════════════════════
│   ├── gatekeeper/
│   │   ├── index.ts           # Module exports
│   │   ├── types.ts           # Gatekeeper-specific types
│   │   │
│   │   ├── wallet/
│   │   │   ├── challenge.ts   # Create wallet challenge
│   │   │   ├── verify.ts      # Verify EIP-191 signature
│   │   │   └── recovery.ts    # ecrecover utilities
│   │   │
│   │   └── funds/
│   │       ├── check.ts       # Balance threshold check
│   │       ├── rpc.ts         # Multi-chain RPC abstraction
│   │       ├── tokens.ts      # ERC-20 balance helpers
│   │       └── providers.ts   # RPC provider configuration
│   │
│   │   ══════════════════════════════════════════
│   │   NEW: MODE STATE MACHINES
│   │   ══════════════════════════════════════════
│   ├── modes/
│   │   ├── index.ts           # Mode exports
│   │   ├── types.ts           # Mode-specific types
│   │   ├── transitions.ts     # Shared state transition logic
│   │   ├── solo.ts            # Solo mode implementation
│   │   ├── fire.ts            # Fire mode (staking/slashing)
│   │   ├── gatekeeper.ts      # Gatekeeper mode (bilateral)
│   │   └── enforced.ts        # Enforced mode (timeouts)
│   │
│   │   ══════════════════════════════════════════
│   │   NEW: CHALLENGE MANAGEMENT
│   │   ══════════════════════════════════════════
│   ├── challenges/
│   │   ├── index.ts           # Challenge exports
│   │   ├── types.ts           # Challenge types
│   │   ├── create.ts          # Create challenge
│   │   ├── accept.ts          # Accept challenge
│   │   ├── resolve.ts         # Resolve challenge
│   │   └── queries.ts         # D1 query helpers
│   │
│   │   ══════════════════════════════════════════
│   │   NEW: WEBHOOK/NOTIFICATION RELAY
│   │   ══════════════════════════════════════════
│   ├── relay/
│   │   ├── index.ts           # Relay exports
│   │   ├── types.ts           # Event/webhook types
│   │   ├── events.ts          # Event emission
│   │   ├── webhooks.ts        # Webhook dispatch
│   │   ├── retry.ts           # Retry queue logic
│   │   ├── email.ts           # Email notifications
│   │   └── sms.ts             # SMS notifications
│   │
│   │   ══════════════════════════════════════════
│   │   NEW: DATABASE LAYER
│   │   ══════════════════════════════════════════
│   ├── db/
│   │   ├── index.ts           # DB exports
│   │   ├── types.ts           # DB record types
│   │   ├── queries.ts         # Common queries
│   │   ├── users.ts           # User queries
│   │   ├── challenges.ts      # Challenge queries
│   │   ├── wallets.ts         # Wallet queries
│   │   └── webhooks.ts        # Webhook queries
│   │
│   ├── handlers/
│   │   ├── attest.ts          # (unchanged)
│   │   ├── health.ts          # (unchanged)
│   │   ├── receipt.ts         # (unchanged)
│   │   ├── sweep.ts           # (unchanged)
│   │   ├── gatekeeper.ts      # NEW: /gatekeeper/v2/* handlers
│   │   ├── challenges.ts      # NEW: /challenges/* handlers
│   │   └── proof.ts           # NEW: /proof/:id handler
│   │
│   ├── jobs/
│   │   ├── queue.ts           # (unchanged)
│   │   └── webhook-retry.ts   # NEW: Webhook retry job
│   │
│   ├── lib/
│   │   ├── http.ts            # (unchanged)
│   │   ├── kv.ts              # (unchanged)
│   │   ├── ids.ts             # (unchanged)
│   │   ├── locks.ts           # (unchanged)
│   │   └── flags.ts           # NEW: Feature flag helpers
│   │
│   ├── models/
│   │   ├── receipt.ts         # (unchanged)
│   │   ├── challenge.ts       # NEW: Challenge model
│   │   ├── wallet.ts          # NEW: Wallet model
│   │   └── attestation.ts     # NEW: Attestation model
│   │
│   ├── utils/
│   │   ├── chains.js          # Extended with more chains
│   │   ├── stripe.js          # (unchanged)
│   │   ├── hmac.js            # (unchanged)
│   │   ├── dev.js             # (unchanged)
│   │   └── validation.ts      # NEW: Zod schemas
│   │
│   └── tests/
│       └── harness.ts         # (unchanged)
│
├── test/
│   ├── index.spec.ts          # (unchanged)
│   ├── gatekeeper-v2.spec.ts  # NEW: v2 tests
│   ├── challenges.spec.ts     # NEW: Challenge tests
│   ├── modes.spec.ts          # NEW: Mode tests
│   ├── env.d.ts
│   └── tsconfig.json
│
├── db/
│   └── migrations/
│       ├── 001_initial.sql    # NEW: Initial schema
│       ├── 002_challenges.sql # NEW: Challenge tables
│       └── 003_webhooks.sql   # NEW: Webhook tables
│
├── .vscode/
│   ├── launch.json            # Debug configurations
│   ├── tasks.json             # Build/test tasks
│   ├── settings.json          # Editor settings
│   └── rest-client/
│       ├── wallet.http        # Wallet API tests
│       ├── challenges.http    # Challenge API tests
│       └── gatekeeper.http    # Gatekeeper API tests
│
├── .github/
│   └── workflows/
│       ├── test.yml           # CI test pipeline
│       ├── deploy-preview.yml # Preview deployment
│       └── deploy-prod.yml    # Production deployment
│
├── wrangler.toml              # Updated with D1 binding
├── ...
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| TypeScript modules | `kebab-case.ts` | `wallet-verify.ts` |
| Handler files | `resource.ts` | `challenges.ts` |
| Type files | `types.ts` in each module | `gatekeeper/types.ts` |
| Test files | `*.spec.ts` | `challenges.spec.ts` |
| SQL migrations | `NNN_description.sql` | `001_initial.sql` |

---

## Import Conventions

```typescript
// External packages first
import { z } from 'zod';

// Internal lib imports (absolute from src/)
import { ok, err } from '../lib/http';
import { generateId } from '../lib/ids';

// Module imports (relative within module)
import { WalletChallenge } from './types';
import { recoverAddress } from './recovery';

// Utility imports
import { getNativeBalance } from '../utils/chains';
```

---

## Module Boundaries

Each module (`gatekeeper/`, `modes/`, `challenges/`, `relay/`) should:

1. **Export through `index.ts`** — single entry point
2. **Have its own `types.ts`** — module-specific types
3. **Not import from sibling modules directly** — go through handlers or shared lib
4. **Have corresponding tests** — `test/[module].spec.ts`

```typescript
// ✅ Good: Import through module index
import { createWalletChallenge, verifyWalletSignature } from '../gatekeeper';

// ❌ Bad: Import internal file directly
import { createChallenge } from '../gatekeeper/wallet/challenge';
```
