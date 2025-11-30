# Feature Flags

> Complete reference for all feature flags and environment variables.  
> Single source of truth for configuration.

---

## Feature Flags

All feature flags default to `false` (disabled) unless explicitly set.

| Flag | Default | Description |
|------|---------|-------------|
| `FF_GATEKEEPER_V2` | `false` | Enable Gatekeeper v2 endpoints (`/gatekeeper/v2/*`) |
| `FF_CHALLENGES` | `false` | Enable Challenge endpoints (`/challenges/*`) |
| `FF_FIRE_MODE` | `false` | Enable Fire mode (staking/slashing) |
| `FF_ENFORCED_MODE` | `false` | Enable Enforced mode (timeouts) |
| `FF_WEBHOOKS` | `false` | Enable webhook registration and delivery |
| `FF_NOTIFICATIONS` | `false` | Enable email/SMS notifications |

### Setting Flags

**Via wrangler.toml (development):**
```toml
[vars]
FF_GATEKEEPER_V2 = "true"
FF_CHALLENGES = "true"
```

**Via Cloudflare Dashboard (production):**
1. Workers & Pages → tattlehash-worker
2. Settings → Variables
3. Add/Edit environment variable

**Via wrangler secrets (sensitive):**
```bash
wrangler secret put FF_GATEKEEPER_V2
# Enter: true
```

### Flag Helper

```typescript
// src/lib/flags.ts

export function getFlag(name: string, env: Record<string, unknown>): boolean {
  const value = env[name];
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

// Usage in handlers:
if (!getFlag('FF_GATEKEEPER_V2', env)) {
  return createError('FEATURE_DISABLED');
}
```

---

## Environment Variables

### Required (Core)

| Variable | Example | Description |
|----------|---------|-------------|
| `HMAC_SECRET` | `your-32-char-min-secret` | Secret for HMAC signing (min 32 chars) |
| `TATTLEHASH_BRAND_NAME` | `TattleHash` | Brand name for receipts/messages |
| `NODE_ENV` | `production` | Environment identifier |
| `ANCHOR_MODE` | `queue` | Anchoring strategy (`queue`, `sync`, `none`) |

### RPC Endpoints

| Variable | Example | Description |
|----------|---------|-------------|
| `RPC_ETH_MAIN` | `https://cloudflare-eth.com` | Ethereum mainnet RPC |
| `RPC_BASE_MAIN` | `https://base-mainnet.public.blastapi.io` | Base mainnet RPC |
| `WEB3_RPC_URL_POLYGON` | `https://polygon-rpc.com` | Polygon mainnet RPC |

**Fallback behavior:** If env var not set, code uses hardcoded fallbacks from `providers.ts`.

### Stripe

| Variable | Example | Description |
|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe API key |
| `STRIPE_FAKE` | `true` | Use fake Stripe (testing only) |

### Notifications (Optional)

| Variable | Example | Description |
|----------|---------|-------------|
| `RESEND_API_KEY` | `re_...` | Resend API key for email |
| `TWILIO_ACCOUNT_SID` | `AC...` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | `...` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | `+1234567890` | Twilio sender number |

### LLM Integration (Future)

| Variable | Example | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | `sk-...` | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | Default model |
| `REF_LLM` | `gpt-4o-mini` | Reference/fallback model |

---

## KV Namespaces

| Binding | Purpose | TTL Strategy |
|---------|---------|--------------|
| `TATTLEHASH_KV` | Primary attestation storage | 30 days default |
| `TATTLEHASH_CONTENT_KV` | Large content/payloads | 30 days |
| `TATTLEHASH_ANCHOR_KV` | Pending anchor jobs | Until processed |
| `TATTLEHASH_ERROR_KV` | Error logging | 7 days |
| `ATT_KV` | v1 attestations | 30 days |
| `GATE_KV` | Gatekeeper nonces/sessions | 15 min - 2 days |
| `SHIELD_KV` | Shield/security data | Varies |

### KV Key Patterns

```
nonce:{nonce}           → Challenge ID (15 min TTL)
idem:{key}              → Idempotency record (1 hour TTL)
rate:{user}:{window}    → Rate limit counter (1 min TTL)
receipt:{id}            → v1 receipt (2 days TTL)
gate:{id}               → v1 gate record (2 days TTL)
trace:{id}              → Trace record (30 days)
```

---

## D1 Database

| Binding | Database Name |
|---------|---------------|
| `TATTLEHASH_DB` | `tattlehash-db` |

**Preview environment:**
```toml
[env.preview.d1_databases]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db-preview"
database_id = "preview-id"
```

---

## Queue

| Binding | Purpose |
|---------|---------|
| `TATTLEHASH_QUEUE` | Async job processing (anchoring, webhooks) |

---

## Durable Objects

| Binding | Class | Purpose |
|---------|-------|---------|
| `AnchorLock` | `AnchorLockDO` | Global lock for anchor batching |

---

## Complete wrangler.toml Example

```toml
name = "tattlehash-worker"
main = "src/worker.js"
compatibility_date = "2025-11-01"
compatibility_flags = ["nodejs_compat"]

# ═══════════════════════════════════════════════════════════
# ENVIRONMENT VARIABLES
# ═══════════════════════════════════════════════════════════

[vars]
NODE_ENV = "production"
TATTLEHASH_BRAND_NAME = "TattleHash"
ANCHOR_MODE = "queue"

# Feature flags (default disabled)
FF_GATEKEEPER_V2 = "false"
FF_CHALLENGES = "false"
FF_FIRE_MODE = "false"
FF_ENFORCED_MODE = "false"
FF_WEBHOOKS = "false"

# RPC endpoints (fallbacks in code)
# RPC_ETH_MAIN = "https://cloudflare-eth.com"
# RPC_BASE_MAIN = "https://base-mainnet.public.blastapi.io"

# ═══════════════════════════════════════════════════════════
# KV NAMESPACES
# ═══════════════════════════════════════════════════════════

[[kv_namespaces]]
binding = "TATTLEHASH_KV"
id = "xxx"

[[kv_namespaces]]
binding = "TATTLEHASH_CONTENT_KV"
id = "xxx"

[[kv_namespaces]]
binding = "TATTLEHASH_ANCHOR_KV"
id = "xxx"

[[kv_namespaces]]
binding = "TATTLEHASH_ERROR_KV"
id = "xxx"

[[kv_namespaces]]
binding = "ATT_KV"
id = "xxx"

[[kv_namespaces]]
binding = "GATE_KV"
id = "xxx"

[[kv_namespaces]]
binding = "SHIELD_KV"
id = "xxx"

# ═══════════════════════════════════════════════════════════
# D1 DATABASE
# ═══════════════════════════════════════════════════════════

[[d1_databases]]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db"
database_id = "xxx"

# ═══════════════════════════════════════════════════════════
# QUEUES
# ═══════════════════════════════════════════════════════════

[[queues.producers]]
binding = "TATTLEHASH_QUEUE"
queue = "tattlehash-jobs"

[[queues.consumers]]
queue = "tattlehash-jobs"
max_batch_size = 10
max_batch_timeout = 30

# ═══════════════════════════════════════════════════════════
# DURABLE OBJECTS
# ═══════════════════════════════════════════════════════════

[durable_objects]
bindings = [
  { name = "AnchorLock", class_name = "AnchorLockDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["AnchorLockDO"]

# ═══════════════════════════════════════════════════════════
# CRON TRIGGERS
# ═══════════════════════════════════════════════════════════

[triggers]
crons = ["*/2 * * * *"]

# ═══════════════════════════════════════════════════════════
# PREVIEW ENVIRONMENT
# ═══════════════════════════════════════════════════════════

[env.preview]
vars = { 
  NODE_ENV = "preview",
  FF_GATEKEEPER_V2 = "true",
  FF_CHALLENGES = "true"
}

[[env.preview.d1_databases]]
binding = "TATTLEHASH_DB"
database_name = "tattlehash-db-preview"
database_id = "preview-xxx"
```

---

## Secrets Management

**Never commit these to git:**
- `HMAC_SECRET`
- `STRIPE_SECRET_KEY`
- `OPENAI_API_KEY`
- `TWILIO_AUTH_TOKEN`
- `RESEND_API_KEY`

**Set via wrangler:**
```bash
wrangler secret put HMAC_SECRET
wrangler secret put STRIPE_SECRET_KEY
```

**Local development:**
Create `.dev.vars` (gitignored):
```
HMAC_SECRET=local-dev-secret-minimum-32-characters
STRIPE_SECRET_KEY=sk_test_...
STRIPE_FAKE=true
```

---

## Rollout Strategy

### Phase 1: Preview Only
```toml
[env.preview.vars]
FF_GATEKEEPER_V2 = "true"
FF_CHALLENGES = "true"
```

### Phase 2: Production (Flag Disabled)
```bash
wrangler deploy
# All flags still false
```

### Phase 3: Gradual Enable
```bash
# Enable one feature at a time
wrangler secret put FF_GATEKEEPER_V2
# Enter: true

# Monitor for 24-48 hours

wrangler secret put FF_CHALLENGES
# Enter: true
```

### Rollback
```bash
wrangler secret put FF_GATEKEEPER_V2
# Enter: false
```
