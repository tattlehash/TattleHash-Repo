
import { D1Database, KVNamespace, Queue } from '@cloudflare/workers-types';

export interface Env {
  TATTLEHASH_DB: D1Database;
  GATE_KV: KVNamespace;
  ATT_KV: KVNamespace;
  TATTLEHASH_QUEUE: Queue;
  TATTLEHASH_KV: KVNamespace;
  TATTLEHASH_CONTENT_KV: KVNamespace;
  TATTLEHASH_ANCHOR_KV: KVNamespace;
  TATTLEHASH_ERROR_KV: KVNamespace;
  SHIELD_KV: KVNamespace;
  TEST_TOKEN?: string;
  GATEKEEPER_V2_ENABLED?: string;
  ADMIN_SECRET?: string;
  [key: string]: any;
}
