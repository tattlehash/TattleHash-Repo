import { route } from "./router";
import { postSweep } from "./handlers/sweep";

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => route(req, env),
  scheduled: async (_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) => {
    // cron-driven background anchoring
    await postSweep(new Request("https://internal/sweep", { method: "POST" }), env);
  },
} satisfies ExportedHandler<Env>;
