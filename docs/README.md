# TattleHash Build Specification

> **Version:** 1.0.0  
> **Generated:** November 2025  
> **Target:** Cloudflare Workers + D1 + KV  
> **Existing Repo:** github.com/tattlehash/TattleHash-Repo

---

## What Is This?

This is a **code-ready build specification** for extending TattleHash from its current v4.4 implementation to a full Gatekeeper verification system with multiple transaction modes.

It is designed to be consumed by:
1. **LLM coding agents** (Claude Code, Cursor, Copilot, etc.)
2. **Human developers** who want clear, unambiguous specs

---

## Minimum Viable Product (MVP)

**Core Value Proposition:**  
"Before you send crypto to a stranger, prove they own the wallet and have the funds — with an immutable receipt both parties can trust forever."

### MVP Features (Must Ship)

| Feature | Description | Status |
|---------|-------------|--------|
| Wallet ownership verification | EIP-191 signature challenge/verify | NEW |
| Proof-of-funds (pass/fail) | Balance ≥ threshold check | EXTEND |
| Solo Mode attestations | Single-user attestation creation | NEW |
| Gatekeeper Mode (bilateral) | Both parties verified before intent lock | NEW |
| Basic challenge lifecycle | Create → Accept → Verify → Complete | NEW |
| Shareable proof URL | `/proof/:id` public view | NEW |
| Core hash-chain ledger | I → C → FINAL commitment chain | EXISTS |

### Post-MVP Features (v1.1+)

- Fire Mode (staking/slashing)
- Enforced Mode (timeouts/refunds)
- Email/SMS notifications
- Webhook relay system
- PDF proof generation
- Mini-games engine

---

## How to Use This Spec

### For LLM Coding Agents

```
AGENT INSTRUCTIONS:

1. Read files in this order:
   - README.md (this file) — understand scope
   - 00-decision-log.md — understand WHY decisions were made
   - 01-project-structure.md — know where files go
   - 02-typescript-types.md — core type definitions
   
2. When implementing a feature:
   - Read the relevant guide-snippet first
   - Follow existing patterns in the codebase
   - Run tests after each change
   - Never modify existing v1 code unless explicitly extending
   
3. When ambiguous:
   - Check 00-decision-log.md for prior decisions
   - If not covered, ASK — don't guess
   
4. Testing cadence:
   - Unit tests: after every function
   - Integration tests: after every endpoint
   - E2E: after every feature
```

### For Human Developers

1. **Skim README** — you're doing this now
2. **Review 10-deployment-phases.md** — understand the build order
3. **Start with Phase 1** — Foundation + Wallet Verification
4. **Follow guide-snippets/** — they show exact implementation patterns

---

## File Index

| File | Purpose |
|------|---------|
| `00-decision-log.md` | Architecture Decision Records (ADRs) |
| `01-project-structure.md` | Folder layout and file organization |
| `02-typescript-types.md` | All TypeScript interfaces and types |
| `03-zod-schemas.md` | Request/response validation schemas |
| `04-database-schema.md` | D1 SQL migrations |
| `05-api-endpoints.md` | Complete endpoint reference |
| `06-state-machines.md` | Mode lifecycle diagrams |
| `07-error-taxonomy.md` | All error codes and messages |
| `08-testing-strategy.md` | Unit, integration, E2E approach |
| `09-deployment-phases.md` | Phased build plan with gates |
| `10-worker-integration.md` | How new code merges with v4.4 |
| `11-dependencies.md` | Pinned package versions |
| `12-observability.md` | Logging, tracing patterns |
| `13-feature-flags.md` | Flag definitions |
| `14-external-contracts.md` | RPC, Stripe, email contracts |
| `15-traceai-mapping.md` | PPA claims → code locations |
| `16-patent-candidates.md` | New CIP opportunities |
| `guide-snippets/` | Implementation examples |
| `db/migrations/` | SQL migration files |
| `.vscode/` | VS Code configuration |
| `.github/workflows/` | CI/CD pipelines |

---

## Existing Codebase Summary

**What already exists in your repo:**

```
src/
├── worker.js              # Entry point
├── router.ts              # Route definitions (to extend)
├── gatekeeper.js          # v1 Gatekeeper (keep as-is)
├── hashing.js             # Commitment hashing (reuse)
├── anchor.js              # Async anchoring (reuse)
├── handlers/              # Existing endpoints
├── utils/
│   ├── chains.js          # Balance checking (extend)
│   ├── stripe.js          # Payment flow (reuse)
│   └── hmac.js            # Signing (reuse)
└── lib/                   # HTTP, KV helpers (reuse)
```

**KV Namespaces (from wrangler.toml):**
- `TATTLEHASH_KV` — general storage
- `TATTLEHASH_CONTENT_KV` — content storage
- `TATTLEHASH_ANCHOR_KV` — anchor jobs
- `TATTLEHASH_ERROR_KV` — error logging
- `ATT_KV` / `GATE_KV` / `SHIELD_KV` — attestation/gate storage

**What this spec adds:**
- D1 database for relational data
- Gatekeeper v2 module (wallet verification, multi-asset)
- Mode state machines (Solo, Fire, Gatekeeper, Enforced)
- Challenge lifecycle management
- Webhook/notification relay

---

## Quick Start (After Reading Spec)

```bash
# 1. Create D1 database
wrangler d1 create tattlehash-db

# 2. Update wrangler.toml with the database_id

# 3. Run migrations
wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql

# 4. Start local dev
wrangler dev

# 5. Test wallet challenge endpoint
curl -X POST http://localhost:8787/gatekeeper/v2/wallet/challenge \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", "chain_id": "eip155:1"}'
```

---

## Support

- **GitHub Issues:** github.com/tattlehash/TattleHash-Repo/issues
- **Patent Reference:** TraceAI PPA (October 2025)
- **Live API:** api.tattlehash.com
