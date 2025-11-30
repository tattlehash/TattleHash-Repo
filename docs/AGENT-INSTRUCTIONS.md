# Agent Instructions

> Instructions for LLM coding agents building TattleHash.  
> Read this file completely before starting any implementation.

---

## Your Role

You are building the TattleHash Gatekeeper v2 system. This extends an existing, working Cloudflare Worker deployment. Your goal is to add new functionality without breaking existing features.

---

## Critical Rules

### 1. NEVER Modify These Files

```
src/gatekeeper.js    ← v1 Gatekeeper, production traffic
src/hashing.js       ← Core hashing, used by v1
src/anchor.js        ← Async anchoring, production
src/worker.js        ← Entry point
```

You may IMPORT from these files. You may NOT modify them.

### 2. ALWAYS Follow Existing Patterns

Before writing new code, examine how existing code handles:
- Response formatting (`ok()`, `err()` from `src/lib/http`)
- Route handling (direct conditionals in `src/router.ts`)
- KV storage patterns
- Error handling

Match these patterns exactly.

### 3. Read Before Writing

For each feature, read the corresponding guide-snippet BEFORE writing code:
- Wallet verification → `guide-snippets/wallet-verification.md`
- Funds checking → `guide-snippets/proof-of-funds.md`
- Challenge lifecycle → `guide-snippets/mode-orchestration.md`

### 4. Test After Every Change

After implementing any function:
```bash
npm run test           # Unit tests
wrangler dev           # Start local server
curl localhost:8787/health  # Verify worker runs
```

### 5. Ask When Ambiguous

If a specification is unclear:
1. Check `00-decision-log.md` for prior decisions
2. Check `07-error-taxonomy.md` for error handling
3. If still unclear, ASK — do not guess

---

## Build Order

Follow this exact order. Do not skip phases.

```
Phase 1: Foundation
├── Create D1 database
├── Run migrations
├── Add types to src/db/types.ts
├── Add errors to src/errors.ts
├── TEST: migrations run, types compile

Phase 2: Wallet Verification
├── Read guide-snippets/wallet-verification.md
├── Create src/gatekeeper/wallet/challenge.ts
├── Create src/gatekeeper/wallet/verify.ts
├── Create src/gatekeeper/wallet/recovery.ts
├── Add routes to src/router.ts
├── TEST: challenge/verify flow works

Phase 3: Proof-of-Funds
├── Read guide-snippets/proof-of-funds.md
├── Create src/gatekeeper/funds/check.ts
├── Create src/gatekeeper/funds/rpc.ts
├── Create src/gatekeeper/funds/providers.ts
├── TEST: balance check returns PASSED/FAILED

Phase 4: Challenge Lifecycle
├── Read guide-snippets/mode-orchestration.md
├── Create src/challenges/create.ts
├── Create src/challenges/accept.ts
├── Create src/modes/solo.ts
├── Create src/modes/gatekeeper.ts
├── TEST: full Solo flow, full Gatekeeper flow

Phase 5: Fire + Enforced Modes
├── Create src/modes/fire.ts
├── Create src/modes/enforced.ts
├── Create src/stakes/ module
├── TEST: staking, slashing, timeouts

Phase 6: Relay System
├── Create src/relay/webhooks.ts
├── Create src/relay/retry.ts
├── TEST: webhook delivery with retry
```

---

## File Creation Checklist

When creating a new file:

1. **Add TypeScript types first**
   ```typescript
   // Always start with types
   export interface FundsCheckRequest { ... }
   export interface FundsCheckResponse { ... }
   ```

2. **Add Zod schema for validation**
   ```typescript
   // Every request needs validation
   export const FundsCheckRequestSchema = z.object({ ... });
   ```

3. **Implement the core function**
   ```typescript
   // Pure business logic
   export async function checkFunds(env, data) { ... }
   ```

4. **Create the handler**
   ```typescript
   // HTTP layer
   export async function postFundsCheck(req, env) {
     const data = await parseBody(req, FundsCheckRequestSchema);
     const result = await checkFunds(env, data);
     return ok(result);
   }
   ```

5. **Add the route**
   ```typescript
   // In router.ts
   if (req.method === 'POST' && pathname === '/gatekeeper/v2/funds/check') {
     return postFundsCheck(req, env);
   }
   ```

6. **Write tests**
   ```typescript
   // In test/*.spec.ts
   describe('checkFunds', () => {
     it('returns PASSED when balance >= threshold', () => { ... });
   });
   ```

---

## Code Style

### Response Helpers

```typescript
// Use existing helpers from src/lib/http
import { ok, err } from '../lib/http';

// Success response
return ok({ status: 'VERIFIED', ... });

// Error response
return err(400, 'validation_error', { details: '...' });
```

### Error Handling

```typescript
// Use error taxonomy from src/errors.ts
import { createError } from '../errors';

if (!isValidAddress(address)) {
  return createError('WALLET_INVALID_ADDRESS', { provided: address });
}
```

### Database Queries

```typescript
// Use helpers from src/db/index.ts
import { query, queryOne, execute } from '../db';

const user = await queryOne<User>(env.TATTLEHASH_DB, 
  'SELECT * FROM users WHERE id = ?', 
  [userId]
);
```

### Logging

```typescript
// Structured JSON logs
console.log(JSON.stringify({
  t: Date.now(),
  at: 'wallet_verified',
  challenge_id: id,
  wallet: address,
}));
```

---

## Testing Approach

### Unit Tests

Test pure functions in isolation:

```typescript
import { describe, it, expect } from 'vitest';

describe('canTransition', () => {
  it('allows DRAFT -> INTENT_LOCKED', () => {
    expect(canTransition('SOLO', 'DRAFT', 'INTENT_LOCKED')).toBe(true);
  });
  
  it('prevents COMPLETED -> DRAFT', () => {
    expect(canTransition('SOLO', 'COMPLETED', 'DRAFT')).toBe(false);
  });
});
```

### Integration Tests

Test full flows with mocked external dependencies:

```typescript
describe('Gatekeeper Flow', () => {
  it('completes verification', async () => {
    // Mock RPC
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(...);
    
    // Create challenge
    const challenge = await createWalletChallenge(mockEnv, { ... });
    
    // Verify
    const result = await verifyWalletSignature(mockEnv, { ... });
    
    expect(result.status).toBe('VERIFIED');
  });
});
```

### Manual Testing

```bash
# Start local dev server
wrangler dev

# Test endpoints
curl -X POST http://localhost:8787/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x...", "chain_id": "eip155:1"}'
```

---

## Common Pitfalls

### 1. Forgetting to Lowercase Addresses

```typescript
// ❌ Wrong
const wallet = data.wallet_address;

// ✅ Correct
const wallet = data.wallet_address.toLowerCase();
```

### 2. Not Handling BigInt

```typescript
// ❌ Wrong (JSON can't serialize BigInt)
return ok({ balance: balance });

// ✅ Correct
return ok({ balance: balance.toString() });
```

### 3. Exposing Sensitive Data

```typescript
// ❌ Wrong (exposes actual balance)
return ok({ status: 'PASSED', balance: '5.2 ETH' });

// ✅ Correct (only pass/fail)
return ok({ status: 'PASSED', proof_type: 'OPAQUE_V1' });
```

### 4. Ignoring Feature Flags

```typescript
// ❌ Wrong (feature always enabled)
return postWalletChallenge(req, env);

// ✅ Correct (check flag first)
if (!getFlag('GATEKEEPER_V2_ENABLED', env)) {
  return createError('FEATURE_DISABLED');
}
return postWalletChallenge(req, env);
```

---

## Environment Setup

### Required Tools

```bash
node --version    # >= 18.x
npm --version     # >= 9.x
wrangler --version # >= 3.x
```

### Install Dependencies

```bash
npm install
npm install @noble/hashes @noble/secp256k1  # For crypto
npm install zod  # For validation
```

### Create D1 Database

```bash
wrangler d1 create tattlehash-db
# Copy the database_id to wrangler.toml
```

### Run Migrations

```bash
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql
```

### Start Development

```bash
wrangler dev
```

---

## Completion Checklist

Before marking a phase complete:

- [ ] All functions have TypeScript types
- [ ] All requests validated with Zod
- [ ] All errors use error taxonomy
- [ ] Unit tests written and passing
- [ ] Integration test for happy path
- [ ] Manual curl test works
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] No lint errors (`npm run lint`)
- [ ] Code reviewed against guide-snippet

---

## Getting Help

If stuck:

1. Re-read the relevant guide-snippet
2. Check existing code for patterns
3. Review error taxonomy for error handling
4. Check decision log for rationale
5. Ask the human for clarification

Do NOT:
- Guess at ambiguous requirements
- Skip tests to move faster
- Modify v1 code "just a little"
- Expose sensitive data for debugging
