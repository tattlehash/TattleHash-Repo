import { Env } from "../types";
import { postAttest } from "../handlers/attest";
import { postSweep } from "../handlers/sweep";
import { getReceipt } from "../handlers/receipt";

type TestResult = { name: string; ok: boolean; ms: number; error?: string };

function now() { return (typeof Date !== "undefined") ? Date.now() : 0; }

async function runLifecycle(env: Env): Promise<TestResult> {
  const t0 = now();
  try {
    // 1) POST /attest
    const attestReq = new Request("https://tests/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initiatorCommit: "test-commit" }),
    });
    const attestRes = await postAttest(attestReq, env);
    const attestJson = await attestRes.json() as any;
    const rid = attestJson?.receipt?.id;
    if (!rid) throw new Error("no_receipt_id_from_attest");

    // 2) POST /admin/sweep (process job -> anchor)
    await postSweep(new Request("https://tests/sweep", { method: "POST" }), env);

    // 3) GET /receipt/:id
    const recRes = await getReceipt(new Request("https://tests/receipt"), env, rid);
    const recJson = await recRes.json() as any;
    const mode = recJson?.receipt?.mode;
    const txHash = recJson?.receipt?.txHash;

    if (mode !== "anchored") throw new Error(`expected anchored, got ${mode}`);
    if (!txHash) throw new Error("missing txHash");

    return { name: "attest→sweep→anchored lifecycle", ok: true, ms: now() - t0 };
  } catch (e: any) {
    return { name: "attest→sweep→anchored lifecycle", ok: false, ms: now() - t0, error: String(e?.message || e) };
  }
}

export async function runAllTests(env: Env) {
  const results: TestResult[] = [];
  results.push(await runLifecycle(env));

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { ok: failed === 0, summary: { total: results.length, passed, failed }, results };
}

export function isAuthorized(req: Request, env: Env) {
  const token = req.headers.get("x-test-token");
  return !!env.TEST_TOKEN && token === env.TEST_TOKEN;
}
