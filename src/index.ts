// src/index.ts

// ---------- Types & Env ----------
export interface Env {
  // KV
  TATTLEHASH_KV: KVNamespace;
  TATTLEHASH_CONTENT_KV: KVNamespace;
  TATTLEHASH_ANCHOR_KV: KVNamespace;
  TATTLEHASH_ERROR_KV: KVNamespace;

  // Queue
  TATTLEHASH_QUEUE: Queue<any>;

  // Vars
  TATTLEHASH_BRAND_NAME: string;
  ANCHOR_MODE: string;
  WEB3_RPC_URL_POLYGON: string;
  OPENAI_MODEL: string;

  // Secrets
  ADMIN_SECRET: string;
  OPENAI_API_KEY: string;
  TATTLEHASH_GATE_KEY: string;
}

// ---------- Utility: responses ----------
function jsonCORS(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  return new Response(JSON.stringify(data), { ...init, headers });
}

class TattleHashError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "BAD_REQUEST", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------- Utility: Body parsing & guards ----------
type JsonDict = Record<string, any>;

async function safeJSON(req: Request, maxBytes = 512 * 1024): Promise<JsonDict> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  // Body size guard (best-effort)
  const clone = req.clone();
  const buf = await clone.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new TattleHashError("Payload too large", "PAYLOAD_TOO_LARGE", 413);
  }
  const j: unknown = await req.json().catch(() => ({}));
  return j && typeof j === "object" ? (j as JsonDict) : {};
}

function requireFields<T extends string>(obj: JsonDict, fields: T[]): asserts obj is JsonDict & Record<T, any> {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      throw new TattleHashError(`Missing ${f}`, "BAD_INPUT");
    }
  }
}

// ---------- Placeholder helpers (replace with real logic later) ----------
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function handleUrlScan(body: { url: string }, env: Env): Promise<any> {
  // TODO: real implementation
  return { scanned: true, url: body.url };
}

async function verifyAddressOwnership(chain: string, address: string, challenge: string, signature: string, env: Env): Promise<boolean> {
  // TODO: real implementation
  return true;
}

async function getBalanceInUSD(chain: string, asset: string, address: string, env: Env): Promise<number> {
  // TODO: real implementation
  return 123.45;
}

async function sendWebhook(env: Env, event: string, payload: any): Promise<void> {
  // TODO: real implementation (e.g., fetch to your webhook URL)
  await env.TATTLEHASH_ERROR_KV.put(`webhook:${event}:${Date.now()}`, JSON.stringify(payload), { expirationTtl: 3600 });
}

async function runGuideLLM(env: Env, messages: any[], tools: any[], impl: "openai" | "workers_ai" = "openai"): Promise<any> {
  // TODO: real implementation
  return { content: "ok" };
}

async function queryTxStatus(rec: any, env: Env): Promise<{ confirmations: number; reorged?: boolean }> {
  // TODO: real implementation
  return { confirmations: 12, reorged: false };
}

// ---------- Router-less simple switch ----------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return jsonCORS({ ok: true });

      // 🛰️ Simple structured log for Wrangler Tail
      const { method } = request;
      const url = new URL(request.url);
      const path = url.pathname;
      const time = new Date().toISOString();
      console.log(`[${time}] ${method} ${path}`);

      // Simple health root
      if (path === "/" && request.method === "GET") {
        return jsonCORS({
          ok: true,
          brand: env.TATTLEHASH_BRAND_NAME,
          anchorMode: env.ANCHOR_MODE,
          model: env.OPENAI_MODEL
        });
      }

      // ---------- SCAN: URL ----------
      if (path === "/scan/url" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["url"]);
        const res = await handleUrlScan({ url: String(body.url) }, env);
        return jsonCORS({ ok: true, result: res });
      }

      // ---------- Governance update ----------
      if (path === "/governance/update" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["policyUpdate"]);
        const payloadHash = await sha256Hex(JSON.stringify(body.policyUpdate));
        await env.TATTLEHASH_QUEUE.send({ type: "governance", payload: { policyUpdate: body.policyUpdate, payloadHash } });
        return jsonCORS({ ok: true, payloadHash });
      }

      // ---------- Attestation init (attachments/notify optional) ----------
      if (path === "/attest/init" && request.method === "POST") {
        const body = await safeJSON(request);
        const attestation: any = { id: `att-${Date.now()}`, attachments: [] as any[] };
        if (Array.isArray(body.attachments)) {
          attestation.attachments = body.attachments.slice(0, 10).map((a: any) => ({
            name: String(a?.name ?? "evidence"),
            mime: String(a?.mime ?? "application/octet-stream"),
            sha256: String(a?.sha256 ?? ""),
            ipfsCid: a?.ipfsCid ?? null
          }));
        }
        if (body.notify && (body.notify.email || body.notify.wallet)) {
          const token = crypto.randomUUID();
          await env.TATTLEHASH_KV.put(
            `notify:${token}`,
            JSON.stringify({
              attestationId: attestation.id,
              counterpartyHint: body.notify.wallet ? String(body.notify.wallet).slice(0, 6) + "…" : undefined,
              expiresAt: Date.now() + 7 * 24 * 3600 * 1000
            }),
            { expirationTtl: 7 * 24 * 3600 }
          );
          attestation.notifyToken = token;
        }
        return jsonCORS({ ok: true, attestation });
      }

      // ---------- Counter actions ----------
      if (path === "/counter" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["action"]);
        if (body.action === "verify") {
          // TODO: verify logic
          return jsonCORS({ ok: true, verified: true });
        }
        if (body.action === "counter-attest") {
          const data = body.data ?? {};
          const counterHash = await sha256Hex(JSON.stringify(data));
          return jsonCORS({ ok: true, counterHash });
        }
        throw new TattleHashError("Unknown action", "COUNTER_BAD_INPUT");
      }

      // ---------- Proof-of-funds init ----------
      if (path === "/pof/init" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["minAmountUSD", "chain"]);
        if (typeof body.minAmountUSD !== "number") throw new TattleHashError("minAmountUSD must be number", "POF_BAD_INPUT");
        const token = crypto.randomUUID();
        await env.TATTLEHASH_KV.put(
          `pof:${token}`,
          JSON.stringify({
            minAmountUSD: body.minAmountUSD,
            chain: String(body.chain).toLowerCase(),
            asset: String(body.asset ?? "USDT").toUpperCase(),
            status: "pending",
            createdAt: Date.now()
          }),
          { expirationTtl: 3600 }
        );
        return jsonCORS({ ok: true, token });
      }

      // ---------- Proof-of-funds post (signed) ----------
      if (path === "/pof/post" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["token", "address", "signature", "challenge"]);
        const rec = await env.TATTLEHASH_KV.get(`pof:${body.token}`, { type: "json" }) as any;
        if (!rec) throw new TattleHashError("Token not found", "POF_NOT_FOUND", 404);
        const sigOk = await verifyAddressOwnership(rec.chain, String(body.address), String(body.challenge), String(body.signature), env);
        if (!sigOk) throw new TattleHashError("Signature invalid", "POF_SIG", 401);
        const usd = await getBalanceInUSD(rec.chain, rec.asset, String(body.address), env).catch(() => null);
        if (usd !== null && usd >= rec.minAmountUSD) {
          rec.status = "verified";
          rec.verifiedAt = Date.now();
          rec.address = String(body.address);
          await env.TATTLEHASH_KV.put(`pof:${body.token}`, JSON.stringify(rec), { expirationTtl: 3600 });
          const attId = `att-${Date.now()}`;
          const leafHash = await sha256Hex(attId + String(body.address) + usd);
          await sendWebhook(env, "pof.verified", { attestationId: attId, address: String(body.address), usd, leafHash });
          return jsonCORS({ ok: true, verified: true, usd });
        } else {
          rec.status = "failed";
          rec.failedAt = Date.now();
          rec.address = String(body.address);
          await env.TATTLEHASH_KV.put(`pof:${body.token}`, JSON.stringify(rec), { expirationTtl: 3600 });
          return jsonCORS({ ok: true, verified: false, usd });
        }
      }

      // ---------- Evidence-and-forward (ENF) ----------
      if (path === "/enf/init" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["data", "counterparty"]);
        const id = `enf_${Math.random().toString(36).slice(2, 12)}`;
        const expiryMs = Number(body.expiryMs ?? 24 * 3600 * 1000);
        await env.TATTLEHASH_KV.put(
          `enf:${id}`,
          JSON.stringify({
            baseData: body.data,
            counterparty: body.counterparty,
            status: "pending",
            createdAt: Date.now(),
            expiresAt: Date.now() + expiryMs
          }),
          { expirationTtl: Math.ceil(expiryMs / 1000) + 60 }
        );
        return jsonCORS({ ok: true, id, expiresInMs: expiryMs });
      }

      if (path === "/enf/action" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["id", "action"]);
        const recKey = `enf:${body.id}`;
        const rec = (await env.TATTLEHASH_KV.get(recKey, { type: "json" })) as any;
        if (!rec) throw new TattleHashError("ENF not found", "ENF_NOT_FOUND", 404);

        if (body.action === "sign") {
          const hash = await sha256Hex(JSON.stringify({ ...(rec.baseData || {}), counterpartySig: body.signature ?? "ack" }));
          rec.status = "signed";
          rec.hash = hash;
          await env.TATTLEHASH_KV.put(recKey, JSON.stringify(rec), { expirationTtl: 900 });
          return jsonCORS({ ok: true, code: "ENF_SIGNED", hash });
        }
        if (body.action === "decline") {
          rec.status = "declined";
          await env.TATTLEHASH_KV.put(recKey, JSON.stringify(rec), { expirationTtl: 900 });
          return jsonCORS({ ok: true, code: "ENF_DECLINED" });
        }
        throw new TattleHashError("Unknown ENF action", "ENF_BAD_INPUT");
      }

      // ---------- Game flow ----------
      if (path === "/game/create" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["mode", "players"]);
        if (!Array.isArray(body.players) || body.players.length !== 2) throw new TattleHashError("Provide exactly two players", "GAME_BAD_INPUT");
        const mode = String(body.mode);
        if (!["coin", "duel", "rps"].includes(mode)) throw new TattleHashError("Unsupported mode", "GAME_MODE");

        const id = `match_${Math.random().toString(36).slice(2, 10)}`;
        const serverNonce = crypto.randomUUID();
        const match = {
          id,
          mode,
          serverNonce,
          players: {
            A: { id: String(body.players[0]), commit: null as string | null, revealed: null as any },
            B: { id: String(body.players[1]), commit: null as string | null, revealed: null as any }
          },
          createdAt: Date.now(),
          status: "awaiting_commits",
          expiresAt: Date.now() + 10 * 60 * 1000
        };
        await env.TATTLEHASH_KV.put(`game:match:${id}`, JSON.stringify(match), { expirationTtl: 3600 });
        return jsonCORS({ ok: true, id, serverNonce });
      }

      if (path === "/game/commit" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["matchId", "player", "commit"]);
        const key = `game:match:${String(body.matchId)}`;
        const match = (await env.TATTLEHASH_KV.get(key, { type: "json" })) as any;
        if (!match) throw new TattleHashError("Match not found", "GAME_NOT_FOUND", 404);
        if (!["A", "B"].includes(String(body.player))) throw new TattleHashError("Player must be A or B", "GAME_PLAYER");
        match.players[body.player].commit = String(body.commit);
        match.status = "awaiting_reveals";
        await env.TATTLEHASH_KV.put(key, JSON.stringify(match), { expirationTtl: 3600 });
        return jsonCORS({ ok: true });
      }

      if (path === "/game/reveal" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["matchId", "player", "seed"]);
        const key = `game:match:${String(body.matchId)}`;
        const match = (await env.TATTLEHASH_KV.get(key, { type: "json" })) as any;
        if (!match) throw new TattleHashError("Match not found", "GAME_NOT_FOUND", 404);
        const choiceStr = (match.mode === "duel" || match.mode === "rps") ? String(body.choice ?? "") : "";
        const calcCommit = await sha256Hex(`${String(body.seed)}:${choiceStr}`);
        const expected = match.players[body.player].commit;
        if (expected && calcCommit !== expected) throw new TattleHashError("Commit mismatch", "GAME_COMMIT_MISMATCH", 400);
        match.players[body.player].revealed = { seed: String(body.seed), choice: choiceStr };
        match.status = "resolved";
        await env.TATTLEHASH_KV.put(key, JSON.stringify(match), { expirationTtl: 3600 });
        return jsonCORS({ ok: true, result: "revealed" });
      }

      // ---------- Attachment helper ----------
      if (path === "/attach" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["data"]);
        const isBase64 = body.encoding === "base64";
        let bytes: Uint8Array;
        if (isBase64) {
          const bstr = atob(String(body.data));
          bytes = Uint8Array.from(bstr, c => c.charCodeAt(0));
        } else {
          bytes = new TextEncoder().encode(String(body.data));
        }
        const sha256 = await sha256Hex(String(body.data));
        return jsonCORS({
          ok: true,
          attachment: { name: String(body.name ?? "file"), mime: String(body.mimeType ?? "text/plain"), sha256, size: bytes.byteLength }
        });
      }

      // ---------- Bundle ----------
      if (path === "/bundle" && request.method === "POST") {
        const body = await safeJSON(request);
        requireFields(body, ["attestationId"]);
        // TODO: real implementation
        return jsonCORS({ ok: true, bundled: body.attestationId });
      }

      // ---------- Anchor check (poll & update) ----------
      if (path === "/anchor/poll" && request.method === "POST") {
        const body = await safeJSON(request);
        const pending: any[] = Array.isArray(body?.pending) ? body.pending : [];
        const updated: any[] = [];
        for (const p of pending) {
          const s = await queryTxStatus(p, env).catch(() => null);
          if (!s) continue;
          if (s.confirmations >= 12 && !s.reorged) {
            p.confirmations = s.confirmations;
            p.final = true;
            await env.TATTLEHASH_ANCHOR_KV.put(`anchor:tx:${p.txHash}`, JSON.stringify(p));
            updated.push({ txHash: p.txHash, final: true });
          }
        }
        return jsonCORS({ ok: true, updated });
      }

      // Fallback
      return jsonCORS({ ok: false, error: "Not found" }, { status: 404 });
    } catch (err: any) {
      const status = err?.status ?? 400;
      const code = err?.code ?? "ERROR";
      // Best-effort server log
      try {
        await (env.TATTLEHASH_ERROR_KV.put(`err:${Date.now()}`, JSON.stringify({ code, message: String(err?.message || err), stack: err?.stack?.slice?.(0, 2000) }), { expirationTtl: 24 * 3600 }));
      } catch {}
      return jsonCORS({ ok: false, code, message: String(err?.message || "Unknown error") }, { status });
    }
  },

  // Queue consumer
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        // Example: mark processed
        await env.TATTLEHASH_ERROR_KV.put(`handled:${msg.id}`, JSON.stringify(msg.body), { expirationTtl: 3600 });
        msg.ack();
      } catch {
        msg.retry();
      }
    }
  }
} satisfies ExportedHandler<Env>;
