import { D1Database, DurableObjectNamespace, KVNamespace, Queue, R2Bucket } from '@cloudflare/workers-types';

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

  // R2 Buckets
  TATTLEHASH_PDF_BUCKET?: R2Bucket;
  ENFORCED_BUCKET?: R2Bucket;

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
  POLYGON_PRIVATE_KEY?: string;
  ANCHOR_PRIVATE_KEY?: string;
  OPENAI_API_KEY?: string;
  TATTLEHASH_GATE_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;

  // Feature Flags
  TEST_TOKEN?: string;
  GATEKEEPER_V2_ENABLED?: string;

  // Dossier Export
  VERIFICATION_PORTAL_URL?: string;

  // Allow additional properties for flexibility
  [key: string]: unknown;
}
