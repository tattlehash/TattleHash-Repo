import { ok, err } from "../lib/http";
import { recKey } from "../lib/kv";

export async function getReceipt(_req: Request, env: Env, id: string) {
  const raw = await env.ATT_KV.get(recKey(env, id));
  if (!raw) return err(404, "not_found", { id });
  return ok({ ok: true, receipt: JSON.parse(raw) });
}
