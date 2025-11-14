\# TattleHash Worker



Backend worker for \*\*TattleHash\*\* – a integrity / attestation service that creates verifiable “receipts” for what actually happened in a system.



This repo holds the Cloudflare Worker code that powers TattleHash.com. It handles hashing, receipt generation, health checks, and background jobs so other services can ask, “What really happened?” and get a consistent answer.



---



\## High-level responsibilities



\- 🌐 \*\*HTTP endpoints\*\*

&nbsp; - `health` – basic liveness / readiness checks.

&nbsp; - `attest` – accept inbound events and create an attested record.

&nbsp; - `receipt` – return a normalized receipt for a given request / ID.

&nbsp; - `sweep` – background cleanup or job processing.



\- 🔐 \*\*Hashing \& HMAC utilities\*\*

&nbsp; - Canonicalizes inputs and hashes them in a consistent way.

&nbsp; - Uses HMAC helpers to sign payloads and defend against tampering.

&nbsp; - Utility modules live under `src/utils` and `src/hashing.js`.



\- 🧾 \*\*Receipts \& models\*\*

&nbsp; - Normalized receipt model in `src/models/receipt.ts`.

&nbsp; - Designed so downstream systems (or auditors) can re-derive the same hash from the same inputs.



\- 🧱 \*\*Infrastructure glue\*\*

&nbsp; - Cloudflare KV / storage helpers in `src/lib/\*`.

&nbsp; - Router + handler wiring in `src/router.ts` and `src/index.ts`.

&nbsp; - Job / queue helpers in `src/jobs/queue.ts`.



---



\## Tech stack



\- \*\*Cloudflare Workers\*\* (runtime)

\- \*\*TypeScript\*\* + some \*\*JavaScript\*\*

\- \*\*Wrangler\*\* (Cloudflare CLI / config)

\- \*\*Vitest\*\* for tests (`test/` and `vitest.config.mts`)

\- Node tooling (`package.json`, `package-lock.json`, `tsconfig.json`)



---



\## Project layout



A quick map of the important bits:



```text

public/                     # Any static assets (if used)

src/

&nbsp; anchor.{js,ts}            # Entry/anchor utilities

&nbsp; debug.js                  # Debug helpers

&nbsp; gatekeeper.js             # Request gating / checks

&nbsp; handlers/

&nbsp;   attest.ts               # /attest endpoint

&nbsp;   health.ts               # /health endpoint

&nbsp;   receipt.ts              # /receipt endpoint

&nbsp;   sweep.ts                # /sweep endpoint

&nbsp; hashing.js                # Core hashing helpers

&nbsp; index.ts                  # Worker entry point / router wiring

&nbsp; jobs/queue.ts             # Background jobs / queue helpers

&nbsp; lib/                      # Shared infrastructure helpers (HTTP, KV, locks, IDs…)

&nbsp; models/receipt.ts         # Receipt data model

&nbsp; router.ts                 # Route definitions

&nbsp; shield.js                 # Additional protection / gating

&nbsp; tests/harness.ts          # Test harness utilities

&nbsp; types.ts                  # Shared types

&nbsp; utils/                    # Chains, dev, HMAC, Stripe utilities, etc.

test/

&nbsp; env.d.ts                  # Test environment typings

&nbsp; index.spec.ts             # Main test suite

&nbsp; tsconfig.json             # Test-specific TS config

wrangler.toml               # Cloudflare Worker configuration

wrangler.jsonc.jsonc        # Extra wrangler / deploy config

worker-configuration.d.ts   # Worker environment types



