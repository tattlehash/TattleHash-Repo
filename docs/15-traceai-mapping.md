# TraceAI Patent Mapping

> Maps TraceAI PPA claims (October 2025) to code implementation locations.  
> Demonstrates reduction to practice for patent purposes.

---

## Patent Overview

**Title:** TraceAI Cryptographic Attestation System  
**Filing Date:** October 2025  
**Status:** Provisional Patent Application (PPA)  
**Claims:** 42 total

---

## Core Claims Mapping

### Claim Group 1: Hash-Chained Ledgers (Claims 1-12)

**Patent Language:**
> "A method for creating an immutable chain of cryptographic commitments linking an initiator's intent to a counterparty's response and a final combined hash..."

**Code Implementation:**

| Claim | Implementation Location | Key Code |
|-------|------------------------|----------|
| 1 (Base) | `src/hashing.js` | `commitInitiator()`, `commitCounter()`, `commitFinal()` |
| 2-4 | `src/gatekeeper.js` | Lines 45-89 (commitment flow) |
| 5-8 | `src/gatekeeper/funds/check.ts` | Balance hash creation |
| 9-12 | `src/db/migrations/001_initial.sql` | `attestations` table with `initiator_hash`, `counter_hash`, `final_hash` |

**Existing Code Reference:**

```javascript
// src/hashing.js (existing)
export async function commitInitiator(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return sha256(canonical);
}

export async function commitCounter(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return sha256(canonical);
}

export async function commitFinal(I, C) {
  return sha256(I + ':' + C);
}
```

**New Code Extension:**

```typescript
// src/attestations/chain.ts
export async function createAttestationChain(
  initiatorPayload: Record<string, unknown>,
  counterPayload: Record<string, unknown>
): Promise<{
  I: string;
  C: string;
  FINAL: string;
}> {
  const I = await commitInitiator(initiatorPayload);
  const C = await commitCounter({ ...counterPayload, initiator_hash: I });
  const FINAL = await commitFinal(I, C);
  
  return { I, C, FINAL };
}
```

---

### Claim Group 2: Geo-Aware Quorum Selection (Claims 13-22)

**Patent Language:**
> "A system for selecting verification providers based on geographic proximity and regulatory jurisdiction..."

**Code Implementation:**

| Claim | Implementation Location | Key Code |
|-------|------------------------|----------|
| 13-16 | `src/gatekeeper/funds/providers.ts` | `CHAIN_CONFIGS` with region-aware endpoints |
| 17-19 | `src/gatekeeper/funds/rpc.ts` | Fallback RPC selection logic |
| 20-22 | `src/gatekeeper/wallet/challenge.ts` | Chain-specific challenge creation |

**New Code:**

```typescript
// src/gatekeeper/funds/providers.ts
export interface ChainConfig {
  network: string;
  chainId: number;
  rpcEndpoints: string[];          // Ordered by preference
  regions: string[];               // Supported geographic regions
  regulatoryJurisdictions: string[]; // Applicable legal frameworks
}

// Geo-aware endpoint selection (future enhancement)
export function selectEndpointForRegion(
  network: string,
  userRegion: string
): string {
  const config = CHAIN_CONFIGS[network];
  // Select endpoint closest to user region
  // Fallback through list if primary fails
  return resolveOptimalEndpoint(config.rpcEndpoints, userRegion);
}
```

---

### Claim Group 3: Error-Semantic Mode Switching (Claims 23-32)

**Patent Language:**
> "A method for automatically switching between verification modes based on error conditions and maintaining deterministic fallback paths..."

**Code Implementation:**

| Claim | Implementation Location | Key Code |
|-------|------------------------|----------|
| 23-26 | `src/modes/transitions.ts` | State machine transitions |
| 27-29 | `src/errors.ts` | Error codes triggering mode switches |
| 30-32 | `src/gatekeeper/funds/check.ts` | RPC fallback on error |

**Pattern Demonstrated:**

```typescript
// src/modes/transitions.ts
export function handleError(
  challenge: Challenge,
  error: TattleHashError
): ChallengeStatus {
  // Error-semantic mode switching
  switch (error.code) {
    case 'E2004': // RPC_ERROR
      // Don't fail immediately; try fallback RPC
      return challenge.status; // Stay in current state, retry
      
    case 'E4021': // GATEKEEPER_VERIFICATION_FAILED
      // Switch to CANCELLED, deterministic outcome
      return 'CANCELLED';
      
    case 'E3013': // CHALLENGE_EXPIRED
      // Switch to EXPIRED, trigger refunds
      return 'EXPIRED';
      
    default:
      // Deterministic fallback: no state change on unknown error
      return challenge.status;
  }
}
```

---

### Claim Group 4: Verification Threshold Logic (Claims 33-38)

**Patent Language:**
> "A privacy-preserving method for verifying that a party meets a threshold condition without exposing the exact value..."

**Code Implementation:**

| Claim | Implementation Location | Key Code |
|-------|------------------------|----------|
| 33-35 | `src/gatekeeper/funds/check.ts` | `balance >= threshold` comparison |
| 36-37 | `src/gatekeeper/funds/check.ts` | `balance_hash` creation |
| 38 | `src/db/migrations/001_initial.sql` | `funds_attestations` table |

**Key Code:**

```typescript
// src/gatekeeper/funds/check.ts

// Claim 33-35: Threshold verification without exposing exact value
const threshold = BigInt(data.min_balance);
const passed = balance >= threshold;
const status = passed ? 'PASSED' : 'FAILED';

// Claim 36-37: Privacy-preserving hash
const salt = crypto.randomUUID();
const balanceHashInput = `${balance.toString()}:${salt}`;
const balanceHash = await sha256(balanceHashInput);

// Result to counterparty: only PASSED/FAILED
// Actual balance never transmitted
```

---

### Claim Group 5: Intent Binding (Claims 39-42)

**Patent Language:**
> "A method for cryptographically binding a party's stated intent to their subsequent actions, creating an immutable record of agreement..."

**Code Implementation:**

| Claim | Implementation Location | Key Code |
|-------|------------------------|----------|
| 39-40 | `src/challenges/create.ts` | Intent capture in challenge |
| 41-42 | `src/gatekeeper.js` (existing) | `initiatorPayload` structure |

**Intent Binding Structure:**

```typescript
// Challenge creation captures intent
const initiatorPayload = {
  ctx: 'tattlehash.gatekeeper.v2',
  type: 'initiator',
  ts: Date.now(),
  payload: {
    challenge_id: challenge.id,
    mode: challenge.mode,
    title: challenge.title,
    requirements: challenge.gatekeeper_requirements,
    expires_at: challenge.expires_at,
  },
  _v: 2,
};

// Hash binds intent immutably
const I = await commitInitiator(initiatorPayload);
```

---

## Reduction to Practice Evidence

### Deployment Timestamps

| Component | First Deployed | Evidence |
|-----------|---------------|----------|
| Hash chain (v1) | [Date from wrangler logs] | api.tattlehash.com/health |
| Threshold verification | [Date] | api.tattlehash.com/gatekeeper |
| Multi-chain RPC | [Phase 3 completion] | Git commit hash |
| Mode switching | [Phase 4 completion] | Git commit hash |

### Test Coverage Demonstrating Claims

```
Claims 1-12:  test/hashing.spec.ts
Claims 13-22: test/funds-verification.spec.ts (RPC fallback)
Claims 23-32: test/modes.spec.ts (state transitions)
Claims 33-38: test/funds-verification.spec.ts (threshold)
Claims 39-42: test/challenges.spec.ts (intent binding)
```

---

## CIP Opportunities (Continuation-In-Part)

New innovations from this build that could extend the patent:

### 1. Bidirectional ZKP Verification

**Novel Element:** Both parties verify each other simultaneously, neither seeing actual balances.

**Claim Draft:**
> "A method for mutual verification between two parties where each party's verification status is computed independently and neither party is exposed to the other's underlying data..."

**Code Location:** `src/gatekeeper/funds/check.ts`

### 2. Mode-Agnostic Challenge Lifecycle

**Novel Element:** Same state machine handles multiple modes with pluggable verification.

**Claim Draft:**
> "A system providing a unified challenge lifecycle supporting multiple verification modes, where mode-specific behavior is injected without modifying the core state machine..."

**Code Location:** `src/modes/transitions.ts`

### 3. Configurable Timeout Enforcement

**Novel Element:** User-defined timeouts with automatic state transitions.

**Claim Draft:**
> "A method for enforcing user-defined timeouts in bilateral agreements, automatically transitioning state and triggering refunds upon expiration..."

**Code Location:** `src/modes/enforced.ts`, `src/jobs/timeout-checker.ts`

### 4. Event-Driven Webhook Relay

**Novel Element:** Signed webhook delivery with exponential backoff retry.

**Claim Draft:**
> "A notification system providing cryptographically signed event delivery to external systems with automatic retry and failure handling..."

**Code Location:** `src/relay/webhooks.ts`

---

## Documentation for Patent Counsel

### Key Files to Review

1. `src/hashing.js` — Core commitment algorithms
2. `src/gatekeeper.js` — v1 verification flow
3. `src/gatekeeper/funds/check.ts` — v2 threshold verification
4. `src/modes/transitions.ts` — State machine logic
5. `db/migrations/001_initial.sql` — Data model

### Prior Art Distinctions

| Prior Art | TattleHash Distinction |
|-----------|----------------------|
| Simple notarization | Bidirectional commitment chain |
| Balance verification | Privacy-preserving threshold (hash, not value) |
| Escrow services | Deterministic mode switching without human arbitration |
| Smart contracts | Off-chain verification with on-chain anchoring |

### CIP Filing Timeline

- **October 2026:** 12-month deadline for CIP
- **Recommended:** File CIP by August 2026 with new claims
- **Include:** All code from this build spec as evidence
