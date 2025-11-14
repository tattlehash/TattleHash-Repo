# TattleHash Worker

Backend worker for **TattleHash** – an integrity / attestation service that creates verifiable “receipts” for what actually happened in a system.

This repo holds the Cloudflare Worker code that powers TattleHash.com. It handles hashing, receipt generation, health checks, and background jobs so other services can ask, “What really happened?” and get a consistent answer.

---

## High-level responsibilities

- 🌐 **HTTP endpoints**
  - `health` – basic liveness / readiness checks.
  - `attest` – accept inbound events and create an attested record.
  - `receipt` – return a normalized receipt for a given request / ID.
  - `sweep` – background cleanup or job processing.

- 🔐 **Hashing & HMAC utilities**
  - Canonicalizes inputs and hashes them in a consistent way.
  - Uses HMAC helpers to sign payloads and defend against tampering.
  - Utility modules live under `src/utils` and `src/hashing.js`.

- 🧾 **Receipts & models**
  - Normalized receipt model in `src/models/receipt.ts`.
  - Designed so downstream systems (or auditors) can re-derive the same hash from the same inputs.

- 🧱 **Infrastructure glue**
  - Cloudflare KV / storage helpers in `src/lib/*`.
  - Router + handler wiring in `src/router.ts` and `src/index.ts`.
  - Job / queue helpers in `src/jobs/queue.ts`.

---

## Tech stack

- **Cloudflare Workers** (runtime)
- **TypeScript** + some **JavaScript**
- **Wrangler** (Cloudflare CLI / config)
- **Vitest** for tests (`test/` and `vitest.config.mts`)
- Node tooling (`package.json`, `package-lock.json`, `tsconfig.json`)

---

## Project layout

A quick map of the important bits:

```text
public/                     # Any static assets (if used)

src/
  anchor.{js,ts}            # Entry/anchor utilities
  debug.js                  # Debug helpers
  gatekeeper.js             # Request gating / checks
  handlers/
    attest.ts               # /attest endpoint
    health.ts               # /health endpoint
    receipt.ts              # /receipt endpoint
    sweep.ts                # /sweep endpoint
  hashing.js                # Core hashing helpers
  index.ts                  # Worker entry point / router wiring
  jobs/queue.ts             # Background jobs / queue helpers
  lib/                      # Shared infrastructure helpers (HTTP, KV, locks, IDs…)
  models/receipt.ts         # Receipt data model
  router.ts                 # Route definitions
  shield.js                 # Additional protection / gating
  tests/harness.ts          # Test harness utilities
  types.ts                  # Shared types
  utils/                    # Chains, dev, HMAC, Stripe utilities, etc.

test/
  env.d.ts                  # Test environment typings
  index.spec.ts             # Main test suite
  tsconfig.json             # Test-specific TS config

wrangler.toml               # Cloudflare Worker configuration
wrangler.jsonc.jsonc        # Extra wrangler / deploy config
worker-configuration.d.ts   # Worker environment types
