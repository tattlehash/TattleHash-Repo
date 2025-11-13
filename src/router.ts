import { getHealth } from "./handlers/health";
import { postAttest } from "./handlers/attest";
import { postSweep } from "./handlers/sweep";
import { getReceipt } from "./handlers/receipt";
import { err, ok } from "./lib/http";
import { runAllTests, isAuthorized } from "./tests/harness";

export async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization, idempotency-key, x-test-token",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      },
    });
  }

  // Health
  if (req.method === "GET" && pathname === "/health") return getHealth();

  // TESTS (guarded)
  if (req.method === "POST" && pathname === "/__tests") {
    if (!isAuthorized(req, env)) return err(403, "forbidden");
    const result = await runAllTests(env);
    return ok(result, { status: result.ok ? 200 : 500 });
  }

  // Attest
  if (req.method === "POST" && pathname === "/attest") return postAttest(req, env);

  // Receipts
  const m = pathname.match(/^\/receipt\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && m?.groups?.id) return getReceipt(req, env, m.groups.id);

  // Admin sweep
  if (req.method === "POST" && pathname === "/admin/sweep") return postSweep(req, env);

  return err(404, "route_not_found", { method: req.method, pathname });
}
