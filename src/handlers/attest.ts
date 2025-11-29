import { ok, err } from "../lib/http";
import { makeReceipt } from "../models/receipt";
import { enqueue } from "../jobs/queue";
import { recKey } from "../lib/kv";
import { Env } from "../types";

export async function postAttest(req: Request, env: Env): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { }

  const initiatorCommit = body?.initiatorCommit;
  const receipt = makeReceipt(env, initiatorCommit);

  await env.ATT_KV.put(recKey(env, receipt.id), JSON.stringify(receipt));
  await enqueue(env, { id: crypto.randomUUID(), receiptId: receipt.id });

  return ok({ ok: true, receipt });
}
