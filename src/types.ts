import { D1Database, DurableObjectNamespace, KVNamespace, Queue } from '@cloudflare/workers-types';

export interface Env {
  // D1 Database
  TATTLEHASH_DB: D1Database;

  // KV Namespaces
  TATTLEHASH_KV: KVNamespace;
  TATTLEHASH_CONTENT_KV: KVNamespace;
  TATTLEHASH_ANCHOR_KV: KVNamespace;
  TATTLEHASH_ERROR_KV: KVNamespace;
  ATT_KV: KVNamespace;
  GATE_KV: KVNamespace;
  SHIELD_KV: KVNamespace;

  // Queue
  TATTLEHASH_QUEUE: Queue;

  // Durable Objects
  AnchorLock?: DurableObjectNamespace;

  // Environment Variables (from wrangler.toml [vars])
  TATTLEHASH_BRAND_NAME?: string;
  /** Anchor mode: 'mock' (testing), 'relay' (external service), or 'direct' (RPC) */
  ANCHOR_MODE?: 'mock' | 'relay' | 'direct' | string;
  WEB3_RPC_URL_POLYGON?: string;
  OPENAI_MODEL?: string;
  NODE_ENV?: string;
  RPC_ETH_MAIN?: string;
  RPC_BASE_MAIN?: string;
  POLICY_VERSION?: string;
  QUEUE_PREFIX?: string;
  RECEIPT_PREFIX?: string;

  // Secrets (from wrangler secret)
  ADMIN_SECRET?: string;
  AUTH_SECRET?: string;
  OPENAI_API_KEY?: string;
  TATTLEHASH_GATE_KEY?: string;

  // Feature Flags
  TEST_TOKEN?: string;
  GATEKEEPER_V2_ENABLED?: string;

  // Allow additional properties for flexibility
  [key: string]: unknown;
}
