# Worker v4.4 Integration

> How new Gatekeeper v2 code integrates with your existing deployment.  
> No breaking changes to existing functionality.

---

## Current Worker Entry Point

Your existing `src/worker.js` (or main entry) handles:
- Route dispatching via `src/router.ts`
- CORS preflight
- Cron triggers for anchoring
- Durable Object for `AnchorLock`

**Do not modify `src/worker.js`** — all changes flow through `router.ts`.

---

## Router Extension

### Current router.ts (simplified)

```typescript
export async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  
  // CORS preflight
  if (req.method === "OPTIONS") { /* ... */ }
  
  // Health
  if (req.method === "GET" && pathname === "/health") return getHealth();
  
  // Tests
  if (req.method === "POST" && pathname === "/__tests") { /* ... */ }
  
  // Attest
  if (req.method === "POST" && pathname === "/attest") return postAttest(req, env);
  
  // Receipts
  const m = pathname.match(/^\/receipt\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && m?.groups?.id) return getReceipt(req, env, m.groups.id);
  
  // Admin sweep
  if (req.method === "POST" && pathname === "/admin/sweep") return postSweep(req, env);
  
  return err(404, "route_not_found", { method: req.method, pathname });
}
```

### Extended router.ts (after build spec)

```typescript
import { getHealth } from "./handlers/health";
import { postAttest } from "./handlers/attest";
import { postSweep } from "./handlers/sweep";
import { getReceipt } from "./handlers/receipt";
import { err, ok } from "./lib/http";
import { runAllTests, isAuthorized } from "./tests/harness";

// NEW IMPORTS
import { getFlag } from "./lib/flags";
import { createError } from "./errors";
import { 
  postWalletChallenge, 
  postWalletVerify,
  postFundsCheck 
} from "./handlers/gatekeeper";
import { 
  postChallenge, 
  getChallenge, 
  postChallengeAccept,
  postChallengeResolve 
} from "./handlers/challenges";
import { getProof } from "./handlers/proof";

export async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization, idempotency-key, x-test-token",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      },
    });
  }

  // Health
  if (req.method === "GET" && pathname === "/health") return getHealth();

  // Tests (guarded)
  if (req.method === "POST" && pathname === "/__tests") {
    if (!isAuthorized(req, env)) return err(403, "forbidden");
    const result = await runAllTests(env);
    return ok(result, { status: result.ok ? 200 : 500 });
  }

  // Attest
  if (req.method === "POST" && pathname === "/attest") return postAttest(req, env);

  // Receipts
  const receiptMatch = pathname.match(/^\/receipt\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && receiptMatch?.groups?.id) {
    return getReceipt(req, env, receiptMatch.groups.id);
  }

  // ═══════════════════════════════════════════════════════════
  // V1 GATEKEEPER (existing - unchanged)
  // These routes continue to work via src/gatekeeper.js
  // ═══════════════════════════════════════════════════════════
  
  // Note: v1 routes are handled in worker.js directly
  // /gatekeeper → handleGatekeeperCreate
  // /gate/:id POST → handleGateVerify  
  // /gate/:id GET → handleGateGet

  // ═══════════════════════════════════════════════════════════
  // V2 GATEKEEPER (new - feature flagged)
  // ═══════════════════════════════════════════════════════════

  if (pathname.startsWith('/gatekeeper/v2/')) {
    // Feature flag check
    if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
      return createError('FEATURE_DISABLED');
    }

    // Wallet verification
    if (req.method === "POST" && pathname === "/gatekeeper/v2/wallet/challenge") {
      return postWalletChallenge(req, env);
    }
    if (req.method === "POST" && pathname === "/gatekeeper/v2/wallet/verify") {
      return postWalletVerify(req, env);
    }

    // Funds verification
    if (req.method === "POST" && pathname === "/gatekeeper/v2/funds/check") {
      return postFundsCheck(req, env);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CHALLENGES (new - feature flagged)
  // ═══════════════════════════════════════════════════════════

  if (pathname.startsWith('/challenges')) {
    if (!getFlag('CHALLENGES_ENABLED', env)) {
      return createError('FEATURE_DISABLED');
    }

    // Create challenge
    if (req.method === "POST" && pathname === "/challenges") {
      return postChallenge(req, env);
    }

    // Get challenge by ID
    const challengeMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)$/);
    if (req.method === "GET" && challengeMatch?.groups?.id) {
      return getChallenge(req, env, challengeMatch.groups.id);
    }

    // Accept challenge
    const acceptMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/accept$/);
    if (req.method === "POST" && acceptMatch?.groups?.id) {
      return postChallengeAccept(req, env, acceptMatch.groups.id);
    }

    // Resolve challenge
    const resolveMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/resolve$/);
    if (req.method === "POST" && resolveMatch?.groups?.id) {
      return postChallengeResolve(req, env, resolveMatch.groups.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC PROOF VIEW
  // ═══════════════════════════════════════════════════════════

  const proofMatch = pathname.match(/^\/proof\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && proofMatch?.groups?.id) {
    return getProof(req, env, proofMatch.groups.id);
  }

  // Admin sweep
  if (req.method === "POST" && pathname === "/admin/sweep") return postSweep(req, env);

  return err(404, "route_not_found", { method: req.method, pathname });
}
```

---

## wrangler.toml Updates

### Add D1 Binding

```toml
# Add after existing KV namespaces

[[d1_databases]]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db"
database_id = "YOUR_DATABASE_ID"  # Get from: wrangler d1 create tattlehash-db
```

### Add Feature Flag Environment Variables

```toml
[vars]
# ... existing vars ...

# Feature flags (default disabled)
FF_GATEKEEPER_V2 = "false"
FF_CHALLENGES = "false"
FF_FIRE_MODE = "false"
FF_ENFORCED_MODE = "false"
FF_WEBHOOKS = "false"
```

### Preview Environment

```toml
[env.preview]
vars = { 
  NODE_ENV = "preview",
  FF_GATEKEEPER_V2 = "true",
  FF_CHALLENGES = "true"
}

[[env.preview.d1_databases]]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db-preview"
database_id = "YOUR_PREVIEW_DATABASE_ID"
```

---

## Environment Types Update

### worker-configuration.d.ts

```typescript
interface Env {
  // ═══════════════════════════════════════════════════════════
  // EXISTING BINDINGS (unchanged)
  // ═══════════════════════════════════════════════════════════
  
  TATTLEHASH_KV: KVNamespace;
  TATTLEHASH_CONTENT_KV: KVNamespace;
  TATTLEHASH_ANCHOR_KV: KVNamespace;
  TATTLEHASH_ERROR_KV: KVNamespace;
  ATT_KV: KVNamespace;
  GATE_KV: KVNamespace;
  SHIELD_KV: KVNamespace;
  
  TATTLEHASH_QUEUE: Queue;
  AnchorLock: DurableObjectNamespace;
  
  TATTLEHASH_BRAND_NAME: string;
  ANCHOR_MODE: string;
  NODE_ENV: string;
  HMAC_SECRET: string;
  
  RPC_ETH_MAIN: string;
  RPC_BASE_MAIN: string;
  WEB3_RPC_URL_POLYGON: string;
  
  STRIPE_SECRET_KEY: string;
  STRIPE_FAKE?: string;
  
  // ═══════════════════════════════════════════════════════════
  // NEW BINDINGS
  // ═══════════════════════════════════════════════════════════
  
  // D1 Database
  TATTLEHASH_DB: D1Database;
  
  // Feature Flags
  FF_GATEKEEPER_V2?: string;
  FF_CHALLENGES?: string;
  FF_FIRE_MODE?: string;
  FF_ENFORCED_MODE?: string;
  FF_WEBHOOKS?: string;
  
  // Notification Services (optional)
  RESEND_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}
```

---

## Feature Flag Helper

### src/lib/flags.ts

```typescript
export function getFlag(name: string, env: Record<string, unknown>): boolean {
  const value = env[name];
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
}

export function requireFlag(name: string, env: Record<string, unknown>): void {
  if (!getFlag(name, env)) {
    throw { code: 'FEATURE_DISABLED' };
  }
}

// Usage:
// if (!getFlag('FF_GATEKEEPER_V2', env)) {
//   return createError('FEATURE_DISABLED');
// }
```

---

## Shared Utilities

The v2 code reuses existing utilities without modification:

### From src/lib/http.ts

```typescript
import { ok, err } from './lib/http';

// Response helpers work the same way
return ok({ status: 'VERIFIED' });
return err(400, 'validation_error', { ... });
```

### From src/hashing.js

```typescript
import { commitInitiator, commitCounter, commitFinal } from './hashing';

// Use existing commitment functions
const I = await commitInitiator(payload);
```

### From src/utils/chains.js

```typescript
import { getNativeBalance, meetsThreshold } from './utils/chains';

// Existing balance check (v2 extends this)
```

### From src/utils/hmac.js

```typescript
import { signLink } from './utils/hmac';

// Existing HMAC signing
```

---

## Migration Steps

### Step 1: Create D1 Database

```bash
wrangler d1 create tattlehash-db
# Note the database_id
```

### Step 2: Update wrangler.toml

Add the D1 binding and feature flags as shown above.

### Step 3: Run Migrations

```bash
# Local
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql

# Production
wrangler d1 execute tattlehash-db --file=db/migrations/001_initial.sql
```

### Step 4: Deploy with Flags Disabled

```bash
wrangler deploy
# All new features disabled by default
```

### Step 5: Enable in Preview First

```bash
wrangler secret put FF_GATEKEEPER_V2 --env preview
# Enter: true
```

### Step 6: Test in Preview

```bash
curl https://preview.api.tattlehash.com/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x...", "chain_id": "eip155:1"}'
```

### Step 7: Gradual Production Rollout

```bash
# Enable feature flag in production
wrangler secret put FF_GATEKEEPER_V2
# Enter: true

# Monitor logs
wrangler tail
```

---

## Rollback Procedure

If issues arise after deployment:

### Option 1: Disable Feature Flag

```bash
wrangler secret put FF_GATEKEEPER_V2
# Enter: false
```

New endpoints immediately return 503. Existing v1 endpoints unaffected.

### Option 2: Rollback Deployment

```bash
wrangler rollback
```

Returns to previous worker version.

### Option 3: Emergency Disable

In Cloudflare Dashboard:
1. Go to Workers & Pages
2. Select `tattlehash-worker`
3. Settings → Disable Worker

All traffic returns 503.
