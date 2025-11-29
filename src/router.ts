import { getHealth } from "./handlers/health";
import { postAttest } from "./handlers/attest";
import { postSweep } from "./handlers/sweep";
import { getReceipt } from "./handlers/receipt";
import { err, ok } from "./lib/http";
import { runAllTests, isAuthorized } from "./tests/harness";
import { requireAdmin } from "./middleware/admin";
import { checkRateLimit } from "./middleware/ratelimit";
import { addSecurityHeaders } from "./middleware/security-headers";
import { getStatus, getMetrics } from "./handlers/admin/health";
import { handleDisputes } from "./handlers/admin/disputes";
import { Env } from "./types";

export async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Apply rate limiting (skip for health check)
  if (pathname !== "/health") {
    const limitType = pathname.startsWith("/admin/") ? 'admin' :
      pathname.startsWith("/challenges") && req.method === 'POST' ? 'challenge_create' :
        'public';
    const rateLimitCheck = await checkRateLimit(req, env, limitType);
    if (!rateLimitCheck.ok) return addSecurityHeaders(rateLimitCheck.response);
  }

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

  // Gatekeeper v2: Wallet verification
  if (req.method === "POST" && pathname === "/gatekeeper/v2/wallet/challenge") {
    const { postWalletChallenge } = await import("./handlers/gatekeeper");
    return postWalletChallenge(req, env);
  }
  if (req.method === "POST" && pathname === "/gatekeeper/v2/wallet/verify") {
    const { postWalletVerify } = await import("./handlers/gatekeeper");
    return postWalletVerify(req, env);
  }
  if (req.method === "POST" && pathname === "/gatekeeper/v2/funds/check") {
    const { postFundsCheck } = await import("./handlers/gatekeeper");
    return postFundsCheck(req, env);
  }

  // Challenges
  if (req.method === "POST" && pathname === "/challenges") {
    const { postCreateChallenge } = await import("./handlers/challenges");
    return postCreateChallenge(req, env);
  }
  const challengeMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && challengeMatch?.groups?.id) {
    const { getChallenge } = await import("./handlers/challenges");
    return getChallenge(req, env, challengeMatch.groups.id);
  }
  const sendMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/send$/);
  if (req.method === "POST" && sendMatch?.groups?.id) {
    const { postSendChallenge } = await import("./handlers/challenges");
    return postSendChallenge(req, env, sendMatch.groups.id);
  }
  const acceptMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/accept$/);
  if (req.method === "POST" && acceptMatch?.groups?.id) {
    const { postAcceptChallenge } = await import("./handlers/challenges");
    return postAcceptChallenge(req, env, acceptMatch.groups.id);
  }
  const completeMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/complete$/);
  if (req.method === "POST" && completeMatch?.groups?.id) {
    const { postCompleteChallenge } = await import("./handlers/challenges");
    return postCompleteChallenge(req, env, completeMatch.groups.id);
  }

  // Game flow
  if (req.method === "POST" && pathname === "/game/create") {
    const { postGameCreate } = await import("./handlers/game");
    return postGameCreate(req, env);
  }
  if (req.method === "POST" && pathname === "/game/commit") {
    const { postGameCommit } = await import("./handlers/game");
    return postGameCommit(req, env);
  }
  if (req.method === "POST" && pathname === "/game/reveal") {
    const { postGameReveal } = await import("./handlers/game");
    return postGameReveal(req, env);
  }

  // ENF (Evidence-and-Forward)
  if (req.method === "POST" && pathname === "/enf/init") {
    const { postEnfInit } = await import("./handlers/enf");
    return postEnfInit(req, env);
  }
  if (req.method === "POST" && pathname === "/enf/action") {
    const { postEnfAction } = await import("./handlers/enf");
    return postEnfAction(req, env);
  }

  // POF (Proof-of-Funds)
  if (req.method === "POST" && pathname === "/pof/init") {
    const { postPofInit } = await import("./handlers/pof");
    return postPofInit(req, env);
  }
  if (req.method === "POST" && pathname === "/pof/post") {
    const { postPofPost } = await import("./handlers/pof");
    return postPofPost(req, env);
  }

  // Governance
  if (req.method === "POST" && pathname === "/governance/update") {
    const { postGovernanceUpdate } = await import("./handlers/governance");
    return postGovernanceUpdate(req, env);
  }

  // Anchor polling
  if (req.method === "POST" && pathname === "/anchor/poll") {
    const { postAnchorPoll } = await import("./handlers/anchor");
    return postAnchorPoll(req, env);
  }

  // Admin routes (protected)
  if (pathname.startsWith("/admin/")) {
    // Admin sweep (legacy, keep for backwards compat)
    if (req.method === "POST" && pathname === "/admin/sweep") return postSweep(req, env);

    // Require authentication for all other admin routes
    const adminCheck = await requireAdmin(req, env);
    if (!adminCheck.ok) return adminCheck.response;

    if (req.method === "GET" && pathname === "/admin/status") return getStatus(req, env);
    if (req.method === "GET" && pathname === "/admin/metrics") return getMetrics(req, env);
    if (pathname.startsWith("/admin/disputes")) return handleDisputes(req, env);
  }

  const notFound = err(404, "route_not_found", { method: req.method, pathname });
  return addSecurityHeaders(notFound);
}
