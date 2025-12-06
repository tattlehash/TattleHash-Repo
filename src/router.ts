import { getHealth } from "./handlers/health";
import { postAttest } from "./handlers/attest";
import { postSweep } from "./handlers/sweep";
import { getReceipt } from "./handlers/receipt";
import { err, ok } from "./lib/http";
import { runAllTests, isAuthorized } from "./tests/harness";
import { requireAdmin } from "./middleware/admin";
import { checkRateLimit, checkVerificationRateLimit } from "./middleware/ratelimit";
import { addSecurityHeaders } from "./middleware/security-headers";
import { validateCsrf } from "./middleware/csrf";
import { getStatus, getMetrics } from "./handlers/admin/health";
import { handleDisputes } from "./handlers/admin/disputes";
import { Env } from "./types";

export async function route(req: Request, env: Env): Promise<Response> {
  // All responses get security headers applied
  const response = await routeInternal(req, env);
  return addSecurityHeaders(response);
}

async function routeInternal(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Apply rate limiting (skip for health check)
  if (pathname !== "/health") {
    const limitType = pathname.startsWith("/admin/") ? 'admin' :
      pathname.startsWith("/challenges") && req.method === 'POST' ? 'challenge_create' :
        'public';
    const rateLimitCheck = await checkRateLimit(req, env, limitType);
    if (!rateLimitCheck.ok) return rateLimitCheck.response;
  }

  // CSRF validation for state-changing requests
  const csrfResult = await validateCsrf(req, env);
  if (csrfResult) return csrfResult;

  // CORS preflight (no security headers needed for OPTIONS)
  if (req.method === "OPTIONS") {
    const origin = req.headers.get('origin');
    const { getCorsOrigin } = await import("./lib/http");
    return new Response(null, {
      headers: {
        "access-control-allow-origin": getCorsOrigin(origin),
        "access-control-allow-headers": "content-type, authorization, idempotency-key, x-test-token",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-credentials": "true",
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

  // ============================================================================
  // Auth & Account Routes
  // ============================================================================

  // Registration
  if (req.method === "POST" && pathname === "/auth/register") {
    const { postRegister } = await import("./handlers/account");
    return postRegister(req, env);
  }

  // Email/password login
  if (req.method === "POST" && pathname === "/auth/login") {
    const { postLogin } = await import("./handlers/account");
    return postLogin(req, env);
  }

  // Verify login code (2FA step)
  if (req.method === "POST" && pathname === "/auth/verify-login-code") {
    const { postVerifyLoginCode } = await import("./handlers/account");
    return postVerifyLoginCode(req, env);
  }

  // Wallet login
  if (req.method === "POST" && pathname === "/auth/login/wallet") {
    const { postWalletLogin } = await import("./handlers/account");
    return postWalletLogin(req, env);
  }

  // Email verification
  if (req.method === "POST" && pathname === "/auth/verify-email") {
    const { postVerifyEmail } = await import("./handlers/account");
    return postVerifyEmail(req, env);
  }

  // Password reset request
  if (req.method === "POST" && pathname === "/auth/forgot-password") {
    const { postForgotPassword } = await import("./handlers/account");
    return postForgotPassword(req, env);
  }

  // Password reset
  if (req.method === "POST" && pathname === "/auth/reset-password") {
    const { postResetPassword } = await import("./handlers/account");
    return postResetPassword(req, env);
  }

  // Get current user profile
  if (req.method === "GET" && pathname === "/auth/me") {
    const { getMe } = await import("./handlers/account");
    return getMe(req, env);
  }

  // Update profile
  if (req.method === "PATCH" && pathname === "/auth/profile") {
    const { patchProfile } = await import("./handlers/account");
    return patchProfile(req, env);
  }

  // Get preferences
  if (req.method === "GET" && pathname === "/auth/preferences") {
    const { getPreferences } = await import("./handlers/account");
    return getPreferences(req, env);
  }

  // Update preferences
  if (req.method === "PATCH" && pathname === "/auth/preferences") {
    const { patchPreferences } = await import("./handlers/account");
    return patchPreferences(req, env);
  }

  // Link wallet to account
  if (req.method === "POST" && pathname === "/auth/link-wallet") {
    const { postLinkWallet } = await import("./handlers/account");
    return postLinkWallet(req, env);
  }

  // Logout
  if (req.method === "POST" && pathname === "/auth/logout") {
    const { postLogout } = await import("./handlers/account");
    return postLogout(req, env);
  }

  // ============================================================================
  // Attestation
  // ============================================================================

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
  // Challenge PDF Export
  const challengeExportMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/export\/pdf$/);
  if (req.method === "GET" && challengeExportMatch?.groups?.id) {
    const { getChallengeExportPdf } = await import("./handlers/challenge-export");
    return getChallengeExportPdf(req, env, challengeExportMatch.groups.id);
  }

  // Coin Toss - Get status for a challenge
  const coinTossStatusMatch = pathname.match(/^\/challenges\/(?<id>[a-zA-Z0-9-]+)\/coin-toss$/);
  if (req.method === "GET" && coinTossStatusMatch?.groups?.id) {
    const { getCoinTossStatusHandler } = await import("./handlers/coin-toss");
    return getCoinTossStatusHandler(req, env, coinTossStatusMatch.groups.id);
  }

  // Game flow - DISABLED FOR BETA (separate from Coin Toss which remains active)
  if (pathname.startsWith("/game/")) {
    return err(501, "feature_disabled", {
      message: "Game endpoints are disabled for beta. Use Coin Toss via /challenges/:id/coin-toss instead.",
    });
  }

  // ENF (Evidence-and-Forward)
  // Legacy endpoints
  if (req.method === "POST" && pathname === "/enf/init") {
    const { postEnfInit } = await import("./handlers/enf");
    return postEnfInit(req, env);
  }
  if (req.method === "POST" && pathname === "/enf/action") {
    const { postEnfAction } = await import("./handlers/enf");
    return postEnfAction(req, env);
  }
  // New RESTful endpoints
  if (req.method === "POST" && pathname === "/enf/bundles") {
    const { postCreateEnfBundle } = await import("./handlers/enf");
    return postCreateEnfBundle(req, env);
  }
  if (req.method === "GET" && pathname === "/enf/bundles") {
    const { getListEnfBundles } = await import("./handlers/enf");
    return getListEnfBundles(req, env);
  }
  const enfBundleMatch = pathname.match(/^\/enf\/bundles\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && enfBundleMatch?.groups?.id) {
    const { getEnfBundleDetails } = await import("./handlers/enf");
    return getEnfBundleDetails(req, env, enfBundleMatch.groups.id);
  }
  const enfSendMatch = pathname.match(/^\/enf\/bundles\/(?<id>[a-zA-Z0-9-]+)\/send$/);
  if (req.method === "POST" && enfSendMatch?.groups?.id) {
    const { postSendEnfBundle } = await import("./handlers/enf");
    return postSendEnfBundle(req, env, enfSendMatch.groups.id);
  }
  const enfCancelMatch = pathname.match(/^\/enf\/bundles\/(?<id>[a-zA-Z0-9-]+)\/cancel$/);
  if (req.method === "POST" && enfCancelMatch?.groups?.id) {
    const { postCancelEnfBundle } = await import("./handlers/enf");
    return postCancelEnfBundle(req, env, enfCancelMatch.groups.id);
  }
  const enfAuditMatch = pathname.match(/^\/enf\/bundles\/(?<id>[a-zA-Z0-9-]+)\/audit$/);
  if (req.method === "GET" && enfAuditMatch?.groups?.id) {
    const { getEnfAuditTrail } = await import("./handlers/enf");
    return getEnfAuditTrail(req, env, enfAuditMatch.groups.id);
  }
  // ENF Bundle PDF Export
  const enfExportPdfMatch = pathname.match(/^\/enf\/bundles\/(?<id>[a-zA-Z0-9-]+)\/export\/pdf$/);
  if (req.method === "GET" && enfExportPdfMatch?.groups?.id) {
    const { getEnfBundleExportPdf } = await import("./handlers/dossier");
    return getEnfBundleExportPdf(req, env, enfExportPdfMatch.groups.id);
  }
  // Public recipient endpoints
  const enfViewMatch = pathname.match(/^\/enf\/view\/(?<token>[a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && enfViewMatch?.groups?.token) {
    const { getEnfView } = await import("./handlers/enf");
    return getEnfView(req, env, enfViewMatch.groups.token);
  }
  if (req.method === "POST" && pathname === "/enf/acknowledge") {
    const { postEnfAcknowledge } = await import("./handlers/enf");
    return postEnfAcknowledge(req, env);
  }
  if (req.method === "POST" && pathname === "/enf/decline") {
    const { postEnfDecline } = await import("./handlers/enf");
    return postEnfDecline(req, env);
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

  // Enforced Mode - Full escrow with threshold logic
  if (req.method === "POST" && pathname === "/enforced/challenges") {
    const { postCreateEnforcedChallenge } = await import("./handlers/enforced");
    return postCreateEnforcedChallenge(req, env);
  }
  const enforcedStakeMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/stake$/);
  if (req.method === "POST" && enforcedStakeMatch?.groups?.id) {
    const { postDepositStake } = await import("./handlers/enforced");
    return postDepositStake(req, env, enforcedStakeMatch.groups.id);
  }
  const enforcedAcceptMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/accept$/);
  if (req.method === "POST" && enforcedAcceptMatch?.groups?.id) {
    const { postAcceptEnforced } = await import("./handlers/enforced");
    return postAcceptEnforced(req, env, enforcedAcceptMatch.groups.id);
  }
  const enforcedCompleteMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/complete$/);
  if (req.method === "POST" && enforcedCompleteMatch?.groups?.id) {
    const { postCompleteEnforced } = await import("./handlers/enforced");
    return postCompleteEnforced(req, env, enforcedCompleteMatch.groups.id);
  }
  const enforcedDisputeMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/dispute$/);
  if (req.method === "POST" && enforcedDisputeMatch?.groups?.id) {
    const { postRaiseDispute } = await import("./handlers/enforced");
    return postRaiseDispute(req, env, enforcedDisputeMatch.groups.id);
  }
  const enforcedResolveMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/resolve$/);
  if (req.method === "POST" && enforcedResolveMatch?.groups?.id) {
    const { postResolveDispute } = await import("./handlers/enforced");
    return postResolveDispute(req, env, enforcedResolveMatch.groups.id);
  }
  const enforcedStatusMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/status$/);
  if (req.method === "GET" && enforcedStatusMatch?.groups?.id) {
    const { getEnforcedStatus } = await import("./handlers/enforced");
    return getEnforcedStatus(req, env, enforcedStatusMatch.groups.id);
  }
  const enforcedTimeoutMatch = pathname.match(/^\/enforced\/challenges\/(?<id>[a-zA-Z0-9-]+)\/check-timeout$/);
  if (req.method === "POST" && enforcedTimeoutMatch?.groups?.id) {
    const { postCheckTimeout } = await import("./handlers/enforced");
    return postCheckTimeout(req, env, enforcedTimeoutMatch.groups.id);
  }

  // ============================================================================
  // Enforced Sessions - Document Review with R2 Storage
  // ============================================================================

  // Create new session
  if (req.method === "POST" && pathname === "/enforced/sessions") {
    const { postCreateSession } = await import("./handlers/enforced-sessions");
    return postCreateSession(req, env);
  }

  // List user's sessions
  if (req.method === "GET" && pathname === "/enforced/sessions") {
    const { getListSessions } = await import("./handlers/enforced-sessions");
    return getListSessions(req, env);
  }

  // Get session details
  const enforcedSessionMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && enforcedSessionMatch?.groups?.id) {
    const { getSession } = await import("./handlers/enforced-sessions");
    return getSession(req, env, enforcedSessionMatch.groups.id);
  }

  // Verify participant (email code)
  const enforcedVerifyMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/verify$/);
  if (req.method === "POST" && enforcedVerifyMatch?.groups?.id) {
    const { postVerifyParticipant } = await import("./handlers/enforced-sessions");
    return postVerifyParticipant(req, env, enforcedVerifyMatch.groups.id);
  }

  // Join session after verification
  const enforcedJoinMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/join$/);
  if (req.method === "POST" && enforcedJoinMatch?.groups?.id) {
    const { postJoinSession } = await import("./handlers/enforced-sessions");
    return postJoinSession(req, env, enforcedJoinMatch.groups.id);
  }

  // Resend verification code
  const enforcedResendMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/resend-code$/);
  if (req.method === "POST" && enforcedResendMatch?.groups?.id) {
    const { postResendCode } = await import("./handlers/enforced-sessions");
    return postResendCode(req, env, enforcedResendMatch.groups.id);
  }

  // Upload document
  const enforcedDocsUploadMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/documents$/);
  if (req.method === "POST" && enforcedDocsUploadMatch?.groups?.id) {
    const { postUploadDocument } = await import("./handlers/enforced-sessions");
    return postUploadDocument(req, env, enforcedDocsUploadMatch.groups.id);
  }

  // List documents
  if (req.method === "GET" && enforcedDocsUploadMatch?.groups?.id) {
    const { getListDocuments } = await import("./handlers/enforced-sessions");
    return getListDocuments(req, env, enforcedDocsUploadMatch.groups.id);
  }

  // Get document download URL
  const enforcedDocUrlMatch = pathname.match(/^\/enforced\/sessions\/(?<sessionId>[a-zA-Z0-9-]+)\/documents\/(?<docId>[a-zA-Z0-9-]+)\/url$/);
  if (req.method === "GET" && enforcedDocUrlMatch?.groups?.sessionId && enforcedDocUrlMatch?.groups?.docId) {
    const { getDocumentDownloadUrl } = await import("./handlers/enforced-sessions");
    return getDocumentDownloadUrl(req, env, enforcedDocUrlMatch.groups.sessionId, enforcedDocUrlMatch.groups.docId);
  }

  // Download document (with token)
  const enforcedDocDownloadMatch = pathname.match(/^\/enforced\/sessions\/(?<sessionId>[a-zA-Z0-9-]+)\/documents\/(?<docId>[a-zA-Z0-9-]+)\/download$/);
  if (req.method === "GET" && enforcedDocDownloadMatch?.groups?.sessionId && enforcedDocDownloadMatch?.groups?.docId) {
    const { getDownloadDocument } = await import("./handlers/enforced-sessions");
    return getDownloadDocument(req, env, enforcedDocDownloadMatch.groups.sessionId, enforcedDocDownloadMatch.groups.docId);
  }

  // Delete document
  const enforcedDocDeleteMatch = pathname.match(/^\/enforced\/sessions\/(?<sessionId>[a-zA-Z0-9-]+)\/documents\/(?<docId>[a-zA-Z0-9-]+)$/);
  if (req.method === "DELETE" && enforcedDocDeleteMatch?.groups?.sessionId && enforcedDocDeleteMatch?.groups?.docId) {
    const { deleteDocumentHandler } = await import("./handlers/enforced-sessions");
    return deleteDocumentHandler(req, env, enforcedDocDeleteMatch.groups.sessionId, enforcedDocDeleteMatch.groups.docId);
  }

  // Submit agreement
  const enforcedAgreeMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/agree$/);
  if (req.method === "POST" && enforcedAgreeMatch?.groups?.id) {
    const { postAgree } = await import("./handlers/enforced-sessions");
    return postAgree(req, env, enforcedAgreeMatch.groups.id);
  }

  // Submit decline
  const enforcedDeclineMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/decline$/);
  if (req.method === "POST" && enforcedDeclineMatch?.groups?.id) {
    const { postDecline } = await import("./handlers/enforced-sessions");
    return postDecline(req, env, enforcedDeclineMatch.groups.id);
  }

  // Get agreement status
  const enforcedAgreementStatusMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/status$/);
  if (req.method === "GET" && enforcedAgreementStatusMatch?.groups?.id) {
    const { getAgreementStatusHandler } = await import("./handlers/enforced-sessions");
    return getAgreementStatusHandler(req, env, enforcedAgreementStatusMatch.groups.id);
  }

  // Request park
  const enforcedParkMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/park$/);
  if (req.method === "POST" && enforcedParkMatch?.groups?.id) {
    const { postPark } = await import("./handlers/enforced-sessions");
    return postPark(req, env, enforcedParkMatch.groups.id);
  }

  // Resume from park
  const enforcedResumeMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/resume$/);
  if (req.method === "POST" && enforcedResumeMatch?.groups?.id) {
    const { postResume } = await import("./handlers/enforced-sessions");
    return postResume(req, env, enforcedResumeMatch.groups.id);
  }

  // Get session events (audit trail)
  const enforcedEventsMatch = pathname.match(/^\/enforced\/sessions\/(?<id>[a-zA-Z0-9-]+)\/events$/);
  if (req.method === "GET" && enforcedEventsMatch?.groups?.id) {
    const { getEvents } = await import("./handlers/enforced-sessions");
    return getEvents(req, env, enforcedEventsMatch.groups.id);
  }

  // ============================================================================
  // Gatekeeper Mutual Verification
  // ============================================================================

  // List profiles
  if (req.method === "GET" && pathname === "/gatekeeper/profiles") {
    const { getProfilesHandler } = await import("./handlers/gatekeeper-mutual");
    return getProfilesHandler(req, env);
  }

  // List check types
  if (req.method === "GET" && pathname === "/gatekeeper/check-types") {
    const { getCheckTypesHandler } = await import("./handlers/gatekeeper-mutual");
    return getCheckTypesHandler(req, env);
  }

  // Get user verification status
  if (req.method === "GET" && pathname === "/gatekeeper/verification") {
    const { getVerificationHandler } = await import("./handlers/gatekeeper-mutual");
    return getVerificationHandler(req, env);
  }

  // Start verification
  if (req.method === "POST" && pathname === "/gatekeeper/verification") {
    const { postStartVerificationHandler } = await import("./handlers/gatekeeper-mutual");
    return postStartVerificationHandler(req, env);
  }

  // Submit wallet signature for verification
  if (req.method === "POST" && pathname === "/gatekeeper/verification/wallet") {
    const { postWalletSignatureHandler } = await import("./handlers/gatekeeper-mutual");
    return postWalletSignatureHandler(req, env);
  }

  // Poll verification status
  if (req.method === "GET" && pathname === "/gatekeeper/verification/status") {
    const { getVerificationStatusHandler } = await import("./handlers/gatekeeper-mutual");
    return getVerificationStatusHandler(req, env);
  }

  // Create gatekeeper session
  if (req.method === "POST" && pathname === "/gatekeeper/sessions") {
    const { postCreateSessionHandler } = await import("./handlers/gatekeeper-mutual");
    return postCreateSessionHandler(req, env);
  }

  // List user's sessions
  if (req.method === "GET" && pathname === "/gatekeeper/sessions") {
    const { getSessionsHandler } = await import("./handlers/gatekeeper-mutual");
    return getSessionsHandler(req, env);
  }

  // Get session details
  const gkSessionMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && gkSessionMatch?.groups?.id) {
    const { getSessionHandler } = await import("./handlers/gatekeeper-mutual");
    return getSessionHandler(req, env, gkSessionMatch.groups.id);
  }

  // Get session info (public for counterparty)
  const gkSessionInfoMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/info$/);
  if (req.method === "GET" && gkSessionInfoMatch?.groups?.id) {
    const { getSessionInfoHandler } = await import("./handlers/gatekeeper-mutual");
    return getSessionInfoHandler(req, env, gkSessionInfoMatch.groups.id);
  }

  // Verify counterparty code
  const gkVerifyCodeMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/verify-code$/);
  if (req.method === "POST" && gkVerifyCodeMatch?.groups?.id) {
    const { postVerifyCodeHandler } = await import("./handlers/gatekeeper-mutual");
    return postVerifyCodeHandler(req, env, gkVerifyCodeMatch.groups.id);
  }

  // Verify counterparty wallet
  const gkVerifyWalletMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/verify-wallet$/);
  if (req.method === "POST" && gkVerifyWalletMatch?.groups?.id) {
    const { postVerifyWalletHandler } = await import("./handlers/gatekeeper-mutual");
    return postVerifyWalletHandler(req, env, gkVerifyWalletMatch.groups.id);
  }

  // Proceed with session
  const gkProceedMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/proceed$/);
  if (req.method === "POST" && gkProceedMatch?.groups?.id) {
    const { postProceedHandler } = await import("./handlers/gatekeeper-mutual");
    return postProceedHandler(req, env, gkProceedMatch.groups.id);
  }

  // Abort session
  const gkAbortMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/abort$/);
  if (req.method === "POST" && gkAbortMatch?.groups?.id) {
    const { postAbortHandler } = await import("./handlers/gatekeeper-mutual");
    return postAbortHandler(req, env, gkAbortMatch.groups.id);
  }

  // Resend verification code
  const gkResendMatch = pathname.match(/^\/gatekeeper\/sessions\/(?<id>[a-zA-Z0-9_-]+)\/resend$/);
  if (req.method === "POST" && gkResendMatch?.groups?.id) {
    const { postResendCodeHandler } = await import("./handlers/gatekeeper-mutual");
    return postResendCodeHandler(req, env, gkResendMatch.groups.id);
  }

  // Webhooks - Subscription management
  if (req.method === "GET" && pathname === "/webhooks/events") {
    const { getWebhookEvents } = await import("./handlers/webhooks");
    return getWebhookEvents(req, env);
  }
  if (req.method === "POST" && pathname === "/webhooks") {
    const { postCreateWebhook } = await import("./handlers/webhooks");
    return postCreateWebhook(req, env);
  }
  if (req.method === "GET" && pathname === "/webhooks") {
    const { getListWebhooks } = await import("./handlers/webhooks");
    return getListWebhooks(req, env);
  }
  const webhookMatch = pathname.match(/^\/webhooks\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && webhookMatch?.groups?.id) {
    const { getWebhook } = await import("./handlers/webhooks");
    return getWebhook(req, env, webhookMatch.groups.id);
  }
  if (req.method === "PATCH" && webhookMatch?.groups?.id) {
    const { patchWebhook } = await import("./handlers/webhooks");
    return patchWebhook(req, env, webhookMatch.groups.id);
  }
  if (req.method === "DELETE" && webhookMatch?.groups?.id) {
    const { deleteWebhookHandler } = await import("./handlers/webhooks");
    return deleteWebhookHandler(req, env, webhookMatch.groups.id);
  }
  const webhookRotateMatch = pathname.match(/^\/webhooks\/(?<id>[a-zA-Z0-9-]+)\/rotate-secret$/);
  if (req.method === "POST" && webhookRotateMatch?.groups?.id) {
    const { postRotateSecret } = await import("./handlers/webhooks");
    return postRotateSecret(req, env, webhookRotateMatch.groups.id);
  }
  const webhookDeliveriesMatch = pathname.match(/^\/webhooks\/(?<id>[a-zA-Z0-9-]+)\/deliveries$/);
  if (req.method === "GET" && webhookDeliveriesMatch?.groups?.id) {
    const { getWebhookDeliveries } = await import("./handlers/webhooks");
    return getWebhookDeliveries(req, env, webhookDeliveriesMatch.groups.id);
  }

  // LLM Monitoring
  if (req.method === "POST" && pathname === "/monitoring/analyze") {
    const { postAnalyze } = await import("./handlers/monitoring");
    return postAnalyze(req, env);
  }
  if (req.method === "POST" && pathname === "/monitoring/analyze/challenge") {
    const { postAnalyzeChallenge } = await import("./handlers/monitoring");
    return postAnalyzeChallenge(req, env);
  }
  if (req.method === "GET" && pathname === "/monitoring/analyses") {
    const { getListAnalyses } = await import("./handlers/monitoring");
    return getListAnalyses(req, env);
  }
  const analysisMatch = pathname.match(/^\/monitoring\/analyses\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && analysisMatch?.groups?.id) {
    const { getAnalysisDetails } = await import("./handlers/monitoring");
    return getAnalysisDetails(req, env, analysisMatch.groups.id);
  }
  const riskScoreMatch = pathname.match(/^\/monitoring\/risk\/(?<type>[A-Z]+)\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && riskScoreMatch?.groups?.type && riskScoreMatch?.groups?.id) {
    const { getRiskScoreEndpoint } = await import("./handlers/monitoring");
    return getRiskScoreEndpoint(req, env, riskScoreMatch.groups.type, riskScoreMatch.groups.id);
  }
  const recommendedModeMatch = pathname.match(/^\/monitoring\/recommended-mode\/(?<type>[A-Z]+)\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && recommendedModeMatch?.groups?.type && recommendedModeMatch?.groups?.id) {
    const { getRecommendedMode } = await import("./handlers/monitoring");
    return getRecommendedMode(req, env, recommendedModeMatch.groups.type, recommendedModeMatch.groups.id);
  }
  if (req.method === "POST" && pathname === "/monitoring/scan-url") {
    const { postScanUrl } = await import("./handlers/monitoring");
    return postScanUrl(req, env);
  }
  if (req.method === "POST" && pathname === "/monitoring/scan-urls") {
    const { postScanUrls } = await import("./handlers/monitoring");
    return postScanUrls(req, env);
  }
  if (req.method === "POST" && pathname === "/monitoring/extract-urls") {
    const { postExtractUrls } = await import("./handlers/monitoring");
    return postExtractUrls(req, env);
  }
  if (req.method === "GET" && pathname === "/monitoring/flags") {
    const { getListFlags } = await import("./handlers/monitoring");
    return getListFlags(req, env);
  }
  const flagResolveMatch = pathname.match(/^\/monitoring\/flags\/(?<id>[a-zA-Z0-9-]+)\/resolve$/);
  if (req.method === "PATCH" && flagResolveMatch?.groups?.id) {
    const { patchResolveFlag } = await import("./handlers/monitoring");
    return patchResolveFlag(req, env, flagResolveMatch.groups.id);
  }

  // ============================================================================
  // Verification Portal
  // ============================================================================

  // Apply verification rate limiting (10/hr per IP, 50/day per attestation ID)
  // Skip for health and stats endpoints
  if (pathname.startsWith("/verify") && pathname !== "/verify/health" && pathname !== "/verify/stats") {
    // Extract attestation ID if present (for per-attestation rate limiting)
    const targetMatch = pathname.match(/^\/verify\/(?:ENF_BUNDLE|CHALLENGE|ATTESTATION)\/([a-zA-Z0-9-]+)$/i);
    const coinTossMatch = pathname.match(/^\/verify\/coin-toss\/([a-zA-Z0-9-]+)$/);
    const attestationId = targetMatch?.[1] || coinTossMatch?.[1];

    const verifyRateLimit = await checkVerificationRateLimit(req, env, attestationId);
    if (!verifyRateLimit.ok) return verifyRateLimit.response;
  }

  if (req.method === "GET" && pathname === "/verify") {
    const { getVerify } = await import("./handlers/verification");
    return getVerify(req, env);
  }
  if (req.method === "POST" && pathname === "/verify") {
    const { postVerify } = await import("./handlers/verification");
    return postVerify(req, env);
  }
  if (req.method === "GET" && pathname === "/verify/health") {
    const { getVerifyHealth } = await import("./handlers/verification");
    return getVerifyHealth(req, env);
  }
  if (req.method === "GET" && pathname === "/verify/stats") {
    const { getVerifyStats } = await import("./handlers/verification");
    return getVerifyStats(req, env);
  }
  if (req.method === "GET" && pathname === "/verify/portal") {
    const { getVerifyPortal } = await import("./handlers/verification");
    return getVerifyPortal(req, env);
  }
  if (req.method === "POST" && pathname === "/verify/proof") {
    const { postVerifyProof } = await import("./handlers/verification");
    return postVerifyProof(req, env);
  }
  const verifyTargetMatch = pathname.match(/^\/verify\/(?<type>ENF_BUNDLE|CHALLENGE|ATTESTATION)\/(?<id>[a-zA-Z0-9-]+)$/i);
  if (req.method === "GET" && verifyTargetMatch?.groups?.type && verifyTargetMatch?.groups?.id) {
    const { getVerifyByTarget } = await import("./handlers/verification");
    return getVerifyByTarget(req, env, verifyTargetMatch.groups.type, verifyTargetMatch.groups.id);
  }

  // Coin Toss Verification (public - anyone can verify fairness)
  const verifyCoinTossMatch = pathname.match(/^\/verify\/coin-toss\/(?<id>[a-zA-Z0-9-]+)$/);
  if (req.method === "GET" && verifyCoinTossMatch?.groups?.id) {
    const { getCoinTossVerificationHandler } = await import("./handlers/coin-toss");
    return getCoinTossVerificationHandler(req, env, verifyCoinTossMatch.groups.id);
  }

  // ============================================================================
  // PDF Dossier Export
  // ============================================================================

  if (req.method === "GET" && pathname === "/dossier/intents") {
    const { getExportIntents } = await import("./handlers/dossier");
    return getExportIntents(req, env);
  }
  if (req.method === "POST" && pathname === "/dossier/export") {
    const { postExportDossier } = await import("./handlers/dossier");
    return postExportDossier(req, env);
  }
  if (req.method === "POST" && pathname === "/dossier/export/metadata") {
    const { postExportMetadata } = await import("./handlers/dossier");
    return postExportMetadata(req, env);
  }

  // ============================================================================
  // Trust Score API
  // ============================================================================

  if (req.method === "GET" && pathname === "/trust-score/health") {
    const { getTrustScoreHealth } = await import("./handlers/trust-score");
    return getTrustScoreHealth(req, env);
  }
  if (req.method === "GET" && pathname === "/trust-score/thresholds") {
    const { getTrustScoreThresholds } = await import("./handlers/trust-score");
    return getTrustScoreThresholds(req, env);
  }
  if (req.method === "POST" && pathname === "/trust-score/batch") {
    const { postBatchTrustScore } = await import("./handlers/trust-score");
    return postBatchTrustScore(req, env);
  }
  const trustScoreHistoryMatch = pathname.match(/^\/trust-score\/(?<wallet>0x[a-fA-F0-9]{40})\/history$/);
  if (req.method === "GET" && trustScoreHistoryMatch?.groups?.wallet) {
    const { getTrustScoreHistoryHandler } = await import("./handlers/trust-score");
    return getTrustScoreHistoryHandler(req, env, trustScoreHistoryMatch.groups.wallet);
  }
  const trustScoreMatch = pathname.match(/^\/trust-score\/(?<wallet>0x[a-fA-F0-9]{40})$/);
  if (req.method === "GET" && trustScoreMatch?.groups?.wallet) {
    const { getTrustScoreHandler } = await import("./handlers/trust-score");
    return getTrustScoreHandler(req, env, trustScoreMatch.groups.wallet);
  }

  // ============================================================================
  // Credits & Loyalty
  // ============================================================================

  if (req.method === "GET" && pathname === "/credits") {
    const { getCreditsHandler } = await import("./handlers/credits");
    return getCreditsHandler(req, env);
  }
  if (req.method === "POST" && pathname === "/credits/redeem") {
    const { postRedeemCredits } = await import("./handlers/credits");
    return postRedeemCredits(req, env);
  }
  if (req.method === "GET" && pathname === "/credits/milestones") {
    const { getMilestonesHandler } = await import("./handlers/credits");
    return getMilestonesHandler(req, env);
  }
  if (req.method === "GET" && pathname === "/credits/tiers") {
    const { getTiersHandler } = await import("./handlers/credits");
    return getTiersHandler(req, env);
  }

  // Referrals
  if (req.method === "POST" && pathname === "/referral/send") {
    const { postSendReferral } = await import("./handlers/credits");
    return postSendReferral(req, env);
  }
  if (req.method === "POST" && pathname === "/referral/claim") {
    const { postClaimReferral } = await import("./handlers/credits");
    return postClaimReferral(req, env);
  }
  if (req.method === "GET" && pathname === "/referral/status") {
    const { getReferralStatusHandler } = await import("./handlers/credits");
    return getReferralStatusHandler(req, env);
  }

  // Promotions
  if (req.method === "POST" && pathname === "/promotions/claim") {
    const { postClaimPromotion } = await import("./handlers/credits");
    return postClaimPromotion(req, env);
  }

  // ============================================================================
  // Payments (Stripe)
  // ============================================================================

  if (req.method === "POST" && pathname === "/payments/create-checkout") {
    const { postCreateCheckout } = await import("./handlers/payments");
    return postCreateCheckout(req, env);
  }
  if (req.method === "GET" && pathname === "/payments/products") {
    const { getProducts } = await import("./handlers/payments");
    return getProducts(req, env);
  }
  if (req.method === "GET" && pathname === "/payments/success") {
    const { getPaymentSuccess } = await import("./handlers/payments");
    return getPaymentSuccess(req, env);
  }
  if (req.method === "GET" && pathname === "/payments/cancel") {
    const { getPaymentCancel } = await import("./handlers/payments");
    return getPaymentCancel(req, env);
  }

  // Stripe Webhook (no auth required - uses signature verification)
  if (req.method === "POST" && pathname === "/webhooks/stripe") {
    const { postStripeWebhook } = await import("./handlers/payments");
    return postStripeWebhook(req, env);
  }

  // Admin routes (ALL protected by auth)
  if (pathname.startsWith("/admin/")) {
    // Require authentication for ALL admin routes (including sweep)
    const adminCheck = await requireAdmin(req, env);
    if (!adminCheck.ok) return adminCheck.response;

    if (req.method === "POST" && pathname === "/admin/sweep") return postSweep(req, env);

    // Manual anchor endpoint for testing
    const anchorMatch = pathname.match(/^\/admin\/anchor\/(?<receiptId>[a-zA-Z0-9-]+)$/);
    if (req.method === "POST" && anchorMatch?.groups?.receiptId) {
      const { postManualAnchor } = await import("./handlers/anchor");
      return postManualAnchor(req, env, anchorMatch.groups.receiptId);
    }

    if (req.method === "GET" && pathname === "/admin/status") return getStatus(req, env);
    if (req.method === "GET" && pathname === "/admin/metrics") return getMetrics(req, env);
    if (pathname.startsWith("/admin/disputes")) return handleDisputes(req, env);

    // Admin: Promotions
    if (req.method === "POST" && pathname === "/admin/promotions") {
      const { postCreatePromotion } = await import("./handlers/credits");
      return postCreatePromotion(req, env);
    }
    if (req.method === "GET" && pathname === "/admin/promotions") {
      const { getListPromotions } = await import("./handlers/credits");
      return getListPromotions(req, env);
    }
    const promoMatch = pathname.match(/^\/admin\/promotions\/(?<id>[a-zA-Z0-9-]+)$/);
    if (promoMatch?.groups?.id) {
      if (req.method === "GET") {
        const { getPromotionDetails } = await import("./handlers/credits");
        return getPromotionDetails(req, env, promoMatch.groups.id);
      }
      if (req.method === "PATCH") {
        const { patchUpdatePromotion } = await import("./handlers/credits");
        return patchUpdatePromotion(req, env, promoMatch.groups.id);
      }
    }
  }

  return err(404, "route_not_found", { method: req.method, pathname });
}
