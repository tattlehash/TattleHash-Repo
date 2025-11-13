import { ok } from "../lib/http";
export const getHealth = async () => ok({ ok: true, ts: Date.now() });
