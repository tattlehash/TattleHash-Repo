
# TattleHash Gatekeeper v2 Deployment Guide

This guide details the steps to deploy the TattleHash Gatekeeper v2 backend to Cloudflare Workers.

## Prerequisites

*   **Node.js**: v18 or later
*   **Wrangler**: Cloudflare Workers CLI (`npm install -g wrangler`)
*   **Cloudflare Account**: With Workers and D1 enabled

## 1. Environment Setup

Ensure you have the necessary bindings created in Cloudflare.

### D1 Database
Create a D1 database if you haven't already:
```bash
wrangler d1 create tattlehash-db
```
Update `wrangler.toml` with the `database_id`.

### KV Namespaces
Create the required KV namespaces:
```bash
wrangler kv:namespace create GATE_KV
wrangler kv:namespace create ATT_KV
# ... create others as needed (TATTLEHASH_KV, etc.)
```
Update `wrangler.toml` with the `id` for each namespace.

### Queue
Create the message queue for webhook retries:
```bash
wrangler queues create tattlehash-queue
```
Update `wrangler.toml` with the queue binding.

## 2. Database Migration

Apply the schema to your D1 database.

**Local Development:**
```bash
wrangler d1 execute tattlehash-db --local --file=./schema.sql
```

**Production:**
```bash
wrangler d1 execute tattlehash-db --remote --file=./schema.sql
```

## 3. Configuration

Set the feature flag to enable Gatekeeper v2:

**Local (`.dev.vars`):**
```
GATEKEEPER_V2_ENABLED=true
```

**Production (Secrets):**
```bash
wrangler secret put GATEKEEPER_V2_ENABLED
# Enter "true"
```

## 4. Deployment

Deploy the worker to Cloudflare:

```bash
npm run deploy
# or
wrangler deploy
```

## 5. Verification

After deployment, verify the endpoints:

*   **Health Check**: `GET https://your-worker.workers.dev/health` (if implemented) or check logs.
*   **Create Challenge**: `POST /gatekeeper/v1/challenges`
*   **Webhook Test**: Create a webhook subscription (via DB insert for now) and trigger an event.

## Troubleshooting

*   **Type Errors**: Ensure `worker-configuration.d.ts` is up to date by running `wrangler types`.
*   **Binding Errors**: Double-check `wrangler.toml` IDs against your Cloudflare dashboard.
*   **Logs**: Use `wrangler tail` to view live logs from the worker.
