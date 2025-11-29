import { route } from "./router";
import { postSweep } from "./handlers/sweep";
import { Env } from "./types";

export { AnchorLock } from "./do/lock";

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => route(req, env),
  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    // cron-driven background anchoring
    await postSweep(new Request("https://internal/sweep", { method: "POST" }), env);
  },
} satisfies ExportedHandler<Env>;
