// Cloudflare bindings
type KV = KVNamespace;
type DO = DurableObjectNamespace;

declare global {
  interface Env {
    TATTLEHASH_ANCHOR_KV: KV;
    ATT_KV: KV;
    AnchorLock: DO;

    // config
    POLICY_VERSION?: string;
    QUEUE_PREFIX?: string;   // default "anchor:jobs:"
    RECEIPT_PREFIX?: string; // default "attest:"
  }
}
export {};
