# Architecture Decision Records (ADRs)

> This file captures the "why" behind every major design decision.  
> LLM agents and future developers should reference this before making changes.

---

## ADR-001: EIP-191 for Wallet Verification (v1)

**Decision:** Use `personal_sign` (EIP-191) for wallet ownership verification in v1.

**Context:** We need to verify that a user controls a wallet address before accepting their intent in a Gatekeeper transaction.

**Options Considered:**
1. EIP-191 `personal_sign` — simple, universal wallet support
2. EIP-712 typed data — more structured, better UX for complex data
3. Dust transaction — send tiny amount from wallet as proof
4. WalletConnect session proof — transport-level verification

**Why EIP-191:**
- Works in ALL wallets (MetaMask, Phantom adapter, hardware wallets)
- Simplest UX — just "sign this message"
- No gas costs
- Sufficient for v1 verification needs

**Trade-offs:**
- Less structured than EIP-712 (can't prevent replay across contracts)
- Message not human-readable in some wallets

**Revisit When:** 
- We need typed data for complex intent binding (v2)
- EIP-712 adoption becomes universal

---

## ADR-002: Minimum Threshold (Not Exact Balance) for Proof-of-Funds

**Decision:** Proof-of-funds checks verify `balance >= threshold`, never exact balance matching.

**Context:** We need to verify a counterparty has sufficient funds before a P2P transaction.

**Why Minimum Threshold:**
- **Privacy:** Exact balance is sensitive financial information
- **Practical:** Balances fluctuate; exact match would fail moments later
- **Sufficient:** "Has at least X" answers the real question
- **Legal:** Reduces liability around financial data handling

**Counterparty sees:** `PASSED` or `FAILED`, never the actual balance.

**Our backend sees:** Full balance (for verification), but we hash it before storing.

**Revisit When:**
- Enterprise customers require exact balance verification
- Regulatory requirements change

---

## ADR-003: D1 for Relational Data, KV for Hot Path

**Decision:** Use Cloudflare D1 (SQLite) for challenges, users, stakes, and webhook history. Keep KV for nonces, idempotency, rate limiting, and cached receipts.

**Context:** Current implementation uses KV for everything. As we add modes with complex state, relational queries become necessary.

**Why Hybrid:**
- **D1 strengths:** Complex queries, relationships, transactions, history
- **KV strengths:** Sub-millisecond reads, simple key lookups, TTL expiry
- **Separation:** Durable state (D1) vs ephemeral/cached state (KV)

**Data Location:**
| Data Type | Storage |
|-----------|---------|
| Users, wallets | D1 |
| Challenges, stakes | D1 |
| Webhook events | D1 |
| Nonces, idempotency keys | KV |
| Rate limit counters | KV |
| Cached receipts | KV (primary), D1 (backup) |

---

## ADR-004: Gatekeeper v2 Alongside v1 (No Breaking Changes)

**Decision:** New Gatekeeper verification lives at `/gatekeeper/v2/*`. Existing `/gatekeeper` and `/gate/:id` routes remain unchanged.

**Context:** Production traffic already uses v1 Gatekeeper. We can't break existing integrations.

**Migration Path:**
1. v2 launches alongside v1
2. New features only in v2
3. v1 continues working indefinitely
4. Deprecation notice when v2 is stable (6+ months)
5. v1 sunset only with major version bump

**Code Structure:**
```
src/gatekeeper.js      # v1 — DO NOT MODIFY
src/gatekeeper/        # v2 — all new code here
```

---

## ADR-005: Privacy-Preserving Pass/Fail (Not Real ZKP) for v1

**Decision:** v1 "ZKP" is actually privacy-preserving pass/fail verification. Real zero-knowledge proofs are abstracted behind an interface for future implementation.

**Context:** True ZK proofs (SNARKs, STARKs) are complex, slow, and expensive. We need to ship.

**What v1 Does:**
- Backend queries actual balance via RPC
- Compares against threshold
- Returns only `PASSED` or `FAILED` to counterparty
- Stores `balance_hash = sha256(balance + salt)` not raw balance

**What Counterparty Sees:**
```json
{
  "proof_type": "opaque_balance_check",
  "status": "PASSED",
  "provider": "tattlehash_gatekeeper_v2"
}
```

**Future Path:**
- `zk_proofs` table with `proof_type` enum
- v1: `OPAQUE_V1`
- v2+: `SNARK`, `STARK`, `SEMAPHORE`

**Patent Note:** This approach is documented in CIP candidates as "privacy-preserving verification with modular proof backend."

---

## ADR-006: User-Configurable Timeouts for Enforced Mode

**Decision:** Enforced Mode timeouts are user-defined with sensible defaults and min/max constraints.

**Defaults:**
- `accept_timeout_seconds`: 900 (15 min)
- `response_timeout_seconds`: 86400 (24 hours)
- `dispute_timeout_seconds`: 259200 (72 hours)

**Constraints:**
| Timeout | Min | Max |
|---------|-----|-----|
| Accept | 60 (1 min) | 604800 (7 days) |
| Response | 300 (5 min) | 2592000 (30 days) |
| Dispute | 3600 (1 hour) | 2592000 (30 days) |

**Why User-Configurable:**
- Different use cases need different windows
- High-value transactions need longer dispute periods
- Quick trades need short accept windows

---

## ADR-007: Event-Driven Architecture with Webhook Relay

**Decision:** All state changes emit events. Webhooks are the primary external notification mechanism.

**Event Flow:**
```
State Change → Event Emitted → Webhook Queue → Retry Loop → External System
                            → Notification Queue → Email/SMS
                            → Audit Log
```

**Why Events:**
- Decouples core logic from notification concerns
- Enables replay/recovery
- Supports multiple consumers
- Audit trail built-in

**Retry Policy:**
- 8 attempts over ~24 hours
- Exponential backoff: 0, 1m, 5m, 15m, 60m, 4h, 4h, 4h
- 2xx = success, 4xx = permanent failure, 5xx = retry

---

## ADR-008: Commitment Chain (I → C → FINAL) Preserved from v1

**Decision:** Keep the existing initiator/counter/final commitment pattern from v1 Gatekeeper.

**Why:**
- Already implemented and working
- Creates audit trail
- Patent-relevant (TraceAI PPA claims)
- Clean cryptographic chain of custody

**How It Works:**
```
I = sha256(initiator_payload)           # What initiator committed to
C = sha256(counter_payload + I)         # Counterparty's response, linked to I
FINAL = sha256(I + C)                   # Combined commitment, proves both agreed
```

**v2 Extension:**
- Same pattern, more data in payloads
- Attestation record links to challenge record
- FINAL hash becomes the shareable proof anchor

---

## ADR-009: Multi-Chain RPC with Fallback Strategy

**Decision:** Support multiple chains with configurable RPC endpoints and automatic fallback.

**Supported Chains (v1):**
| Chain | Network Code | Default RPC |
|-------|--------------|-------------|
| Ethereum | `eip155:1` | cloudflare-eth.com |
| Base | `eip155:8453` | base-mainnet.public.blastapi.io |
| Polygon | `eip155:137` | polygon-rpc.com |
| Arbitrum | `eip155:42161` | arb1.arbitrum.io/rpc |
| Optimism | `eip155:10` | mainnet.optimism.io |

**Fallback Order:**
1. Primary RPC (env var)
2. Public fallback (hardcoded)
3. Error after 3 failures

**Future:**
- Alchemy/Infura paid endpoints
- Solana, Bitcoin support
- RPC health monitoring

---

## ADR-010: Feature Flags for Incremental Rollout

**Decision:** All new features ship behind feature flags.

**Implementation:**
```typescript
const FLAGS = {
  GATEKEEPER_V2_ENABLED: env.FF_GATEKEEPER_V2 === 'true',
  FIRE_MODE_ENABLED: env.FF_FIRE_MODE === 'true',
  ENFORCED_MODE_ENABLED: env.FF_ENFORCED_MODE === 'true',
  WEBHOOKS_ENABLED: env.FF_WEBHOOKS === 'true',
  MINI_GAMES_ENABLED: env.FF_MINI_GAMES === 'true',
}
```

**Rollout Process:**
1. Ship code with flag `false`
2. Enable in preview environment
3. Test thoroughly
4. Enable in production for % of traffic
5. Full rollout
6. Remove flag after 30 days stable

---

## ADR-011: Error Taxonomy with Structured Codes

**Decision:** All errors have structured codes (`E1001`), HTTP status, and human message.

**Format:**
```typescript
{
  code: 'E1001',
  status: 400,
  message: 'Challenge expired',
  details?: { ... }
}
```

**Code Ranges:**
- `E1xxx` — Wallet verification errors
- `E2xxx` — Funds verification errors
- `E3xxx` — Challenge lifecycle errors
- `E4xxx` — Mode-specific errors
- `E5xxx` — Payment errors
- `E9xxx` — System errors

**Why Structured:**
- Clients can handle specific errors programmatically
- Easier debugging and monitoring
- Consistent across all endpoints
- Localizable messages

---

## ADR-012: TypeScript for New Code, Preserve Existing JS

**Decision:** New code in TypeScript. Don't rewrite existing working JS.

**Existing JS Files (don't convert):**
- `gatekeeper.js`
- `hashing.js`
- `anchor.js`
- `shield.js`
- `debug.js`

**New Code (TypeScript):**
- `src/gatekeeper/` (v2 module)
- `src/modes/`
- `src/challenges/`
- `src/relay/`

**Why:**
- Type safety for complex state machines
- Better IDE support
- Catch errors at compile time
- Existing JS works fine, no need to risk regressions

---

## Future ADRs (To Be Written)

- ADR-013: Staking/Slashing Economic Model
- ADR-014: Mini-Games RNG Strategy
- ADR-015: PDF Generation Pipeline
- ADR-016: Cross-Chain Replication
- ADR-017: Soulbound NFT Minting
