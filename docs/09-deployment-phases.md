# Deployment Phases

> Phased build plan with test gates and rollback procedures.  
> Each phase must pass all gates before proceeding.

---

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Foundation          │  Week 1-2                   │
│  D1 schema, types, base setup │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 2: Wallet Verification │  Week 3                     │
│  EIP-191 challenge/verify     │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 3: Proof-of-Funds      │  Week 4                     │
│  Multi-chain balance checks   │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 4: Challenge Lifecycle │  Week 5-6                   │
│  CRUD + Solo/Gatekeeper modes │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 5: Fire + Enforced     │  Week 7-8                   │
│  Staking, slashing, timeouts  │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 6: Relay System        │  Week 9                     │
│  Webhooks, notifications      │                             │
├─────────────────────────────────────────────────────────────┤
│  Phase 7: Hardening           │  Week 10                    │
│  Load test, security, audit   │                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (Week 1-2)

### Scope
- Create D1 database and run migrations
- Add TypeScript types for all new entities
- Add Zod validation schemas
- Add error taxonomy
- Update wrangler.toml with D1 binding
- Add feature flags infrastructure

### Tasks

```bash
# 1. Create D1 database
wrangler d1 create tattlehash-db

# 2. Add binding to wrangler.toml
[[d1_databases]]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db"
database_id = "<your-id>"

# 3. Run initial migration
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql

# 4. Create new files
src/errors.ts
src/db/index.ts
src/db/types.ts
src/lib/flags.ts
src/utils/validation.ts
```

### Test Gate

```typescript
// test/foundation.spec.ts
describe('Foundation', () => {
  it('D1 migrations run without error', async () => {
    // Run migrations against test DB
  });
  
  it('all Zod schemas compile', () => {
    // Import and validate schemas exist
  });
  
  it('error codes are unique', () => {
    const codes = Object.values(ERRORS).map(e => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
  
  it('feature flags default to disabled', () => {
    expect(getFlag('GATEKEEPER_V2_ENABLED', {})).toBe(false);
  });
});
```

### Rollback
- Delete D1 database: `wrangler d1 delete tattlehash-db`
- Revert wrangler.toml changes
- No production impact (new code not deployed)

---

## Phase 2: Wallet Verification (Week 3)

### Scope
- Implement wallet challenge creation
- Implement EIP-191 signature verification
- Add `/gatekeeper/v2/wallet/challenge` endpoint
- Add `/gatekeeper/v2/wallet/verify` endpoint

### Tasks

```bash
# Create new files
src/gatekeeper/index.ts
src/gatekeeper/types.ts
src/gatekeeper/wallet/challenge.ts
src/gatekeeper/wallet/verify.ts
src/gatekeeper/wallet/recovery.ts
src/gatekeeper/wallet/schemas.ts
src/handlers/gatekeeper.ts  # v2 handlers
src/utils/crypto.ts

# Update existing files
src/router.ts  # Add new routes
```

### Dependencies

```bash
npm install @noble/hashes @noble/secp256k1
```

### Test Gate

```typescript
// test/wallet-verification.spec.ts
describe('Wallet Verification', () => {
  it('creates challenge with valid nonce', async () => { });
  it('challenge expires after TTL', async () => { });
  it('verifies valid EIP-191 signature', async () => { });
  it('rejects invalid signature', async () => { });
  it('rejects expired challenge', async () => { });
  it('rejects already-used challenge', async () => { });
  it('normalizes addresses to lowercase', async () => { });
});
```

### Manual Verification

```bash
# Local testing
wrangler dev

# Create challenge
curl -X POST http://localhost:8787/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", "chain_id": "eip155:1"}'

# Verify with MetaMask (manual)
# 1. Copy message from response
# 2. Sign with personal_sign in browser console
# 3. Submit signature to /verify endpoint
```

### Feature Flag
```
FF_GATEKEEPER_V2=true  # Enable in preview first
```

### Rollback
- Disable feature flag: `FF_GATEKEEPER_V2=false`
- Routes return 503 when flag disabled

---

## Phase 3: Proof-of-Funds (Week 4)

### Scope
- Implement multi-chain RPC abstraction
- Implement native balance checking
- Implement ERC-20 balance checking
- Add `/gatekeeper/v2/funds/check` endpoint
- Privacy-preserving balance hashing

### Tasks

```bash
# Create new files
src/gatekeeper/funds/check.ts
src/gatekeeper/funds/rpc.ts
src/gatekeeper/funds/providers.ts
src/gatekeeper/funds/tokens.ts
src/gatekeeper/funds/schemas.ts
```

### Test Gate

```typescript
// test/funds-verification.spec.ts
describe('Funds Verification', () => {
  it('returns PASSED when balance >= threshold', async () => { });
  it('returns FAILED when balance < threshold', async () => { });
  it('checks ERC-20 balances', async () => { });
  it('handles RPC failures gracefully', async () => { });
  it('never exposes actual balance', async () => { });
  it('stores hashed balance in attestation', async () => { });
});
```

### Manual Verification

```bash
# Check a known wallet with funds
curl -X POST http://localhost:8787/gatekeeper/v2/funds/check \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "network": "eth-mainnet",
    "asset_type": "NATIVE",
    "min_balance": "1000000000000000000"
  }'
```

### Rollback
- Feature flag controls access
- No changes to existing v1 balance checking

---

## Phase 4: Challenge Lifecycle (Week 5-6)

### Scope
- Implement challenge CRUD operations
- Implement Solo mode state machine
- Implement Gatekeeper mode state machine
- Add `/challenges` endpoints
- Link challenges to wallet/funds verification

### Tasks

```bash
# Create new files
src/challenges/index.ts
src/challenges/types.ts
src/challenges/create.ts
src/challenges/accept.ts
src/challenges/resolve.ts
src/challenges/queries.ts
src/challenges/schemas.ts
src/modes/index.ts
src/modes/transitions.ts
src/modes/solo.ts
src/modes/gatekeeper.ts
src/handlers/challenges.ts
```

### Test Gate

```typescript
// test/challenges.spec.ts
describe('Challenge Lifecycle', () => {
  describe('Solo Mode', () => {
    it('creates challenge in DRAFT status', async () => { });
    it('transitions DRAFT -> INTENT_LOCKED', async () => { });
    it('transitions INTENT_LOCKED -> COMPLETED', async () => { });
    it('prevents invalid transitions', async () => { });
  });
  
  describe('Gatekeeper Mode', () => {
    it('creates with counterparty requirement', async () => { });
    it('transitions through acceptance flow', async () => { });
    it('runs verification before intent lock', async () => { });
    it('cancels if verification fails', async () => { });
  });
});
```

### Integration Test

```typescript
// test/integration/gatekeeper-flow.spec.ts
describe('Full Gatekeeper Flow', () => {
  it('completes end-to-end P2P verification', async () => {
    // 1. Creator creates challenge
    // 2. Counterparty accepts
    // 3. Both verify wallets
    // 4. Both pass funds checks
    // 5. Intent locks
    // 6. Both confirm completion
    // 7. Final attestation created
  });
});
```

### Rollback
- Feature flag: `FF_CHALLENGES=true`
- Independent of v1 endpoints

---

## Phase 5: Fire + Enforced Modes (Week 7-8)

### Scope
- Implement Fire mode with staking/slashing
- Implement Enforced mode with configurable timeouts
- Add stake management
- Add timeout job processing

### Tasks

```bash
# Create new files
src/modes/fire.ts
src/modes/enforced.ts
src/stakes/index.ts
src/stakes/create.ts
src/stakes/slash.ts
src/stakes/refund.ts
src/jobs/timeout-checker.ts
```

### Test Gate

```typescript
// test/fire-mode.spec.ts
describe('Fire Mode', () => {
  it('requires honesty bond from both parties', async () => { });
  it('slashes loser bond on resolution', async () => { });
  it('distributes slash correctly', async () => { });
  it('refunds on DRAW or NO_CONTEST', async () => { });
});

// test/enforced-mode.spec.ts
describe('Enforced Mode', () => {
  it('uses custom timeout values', async () => { });
  it('expires and refunds on accept timeout', async () => { });
  it('expires and refunds on response timeout', async () => { });
  it('enforces timeout constraints', async () => { });
});
```

### Feature Flags

```
FF_FIRE_MODE=true
FF_ENFORCED_MODE=true
```

---

## Phase 6: Relay System (Week 9)

### Scope
- Implement webhook registration
- Implement webhook dispatch with retries
- Implement email notifications
- Implement SMS notifications

### Tasks

```bash
# Create new files
src/relay/index.ts
src/relay/types.ts
src/relay/events.ts
src/relay/webhooks.ts
src/relay/retry.ts
src/relay/email.ts
src/relay/sms.ts
src/handlers/webhooks.ts
src/jobs/webhook-retry.ts
```

### External Dependencies

```bash
# Email: Resend
npm install resend

# SMS: Twilio
npm install twilio
```

### Environment Variables

```toml
RESEND_API_KEY = "re_..."
TWILIO_ACCOUNT_SID = "AC..."
TWILIO_AUTH_TOKEN = "..."
TWILIO_FROM_NUMBER = "+1..."
```

### Test Gate

```typescript
// test/webhooks.spec.ts
describe('Webhooks', () => {
  it('dispatches event to registered endpoint', async () => { });
  it('signs payload with HMAC', async () => { });
  it('retries on failure with backoff', async () => { });
  it('marks as failed after max retries', async () => { });
});
```

### Feature Flag

```
FF_WEBHOOKS=true
```

---

## Phase 7: Hardening (Week 10)

### Scope
- Load testing
- Security review
- Documentation cleanup
- Audit preparation

### Load Testing

```bash
# Using k6 or similar
k6 run --vus 100 --duration 60s load-test.js
```

Target metrics:
- p99 latency < 200ms
- Error rate < 0.1%
- Throughput > 1000 req/sec

### Security Checklist

- [ ] All inputs validated with Zod
- [ ] SQL queries use parameterized statements
- [ ] No secrets in logs
- [ ] Rate limiting on all endpoints
- [ ] CORS configured correctly
- [ ] HMAC signatures on webhooks
- [ ] Challenge nonces are cryptographically random
- [ ] Balance data never exposed to counterparty

### Documentation

- [ ] README updated with v2 endpoints
- [ ] API documentation generated
- [ ] Changelog updated
- [ ] Migration guide for v1 users

### Audit Preparation

- [ ] Code frozen for audit
- [ ] Audit scope document prepared
- [ ] Test coverage report > 80%
- [ ] All TODO comments resolved

---

## Deployment Checklist

### Preview Deployment

```bash
# 1. Run all tests
npm run test

# 2. Deploy to preview
wrangler deploy --env preview

# 3. Smoke test
curl https://preview.api.tattlehash.com/health

# 4. Enable feature flags in preview
# (via Cloudflare dashboard or wrangler secret)
```

### Production Deployment

```bash
# 1. Ensure all preview tests pass
# 2. Run D1 migrations in production
wrangler d1 execute tattlehash-db --file=db/migrations/001_initial.sql

# 3. Deploy with flags disabled
wrangler deploy

# 4. Gradually enable flags
# - 10% traffic
# - 50% traffic  
# - 100% traffic

# 5. Monitor error rates and latency
```

### Rollback Procedure

```bash
# Option 1: Disable feature flags
wrangler secret put FF_GATEKEEPER_V2 --env production
# Enter: false

# Option 2: Roll back to previous version
wrangler rollback --env production

# Option 3: Emergency: disable entire worker
# (via Cloudflare dashboard)
```

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Unit test coverage | > 80% |
| Integration test coverage | > 60% |
| p99 latency | < 200ms |
| Error rate | < 0.1% |
| Wallet verification success rate | > 99% |
| Funds check success rate | > 95% |
| Webhook delivery rate | > 99% |
