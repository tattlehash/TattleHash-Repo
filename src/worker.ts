import { route } from "./router";
import { postSweep } from "./handlers/sweep";
import { handleQueueMessage } from "./handlers/queue";
import { Env } from "./types";

export { AnchorLock } from "./do/lock";

export default {
  fetch: (req: Request, env: Env, _ctx: ExecutionContext) => route(req, env),

  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    // cron-driven background anchoring
    await postSweep(new Request("https://internal/sweep", { method: "POST" }), env);
  },

  queue: async (batch: MessageBatch, env: Env) => {
    await handleQueueMessage(batch, env);
  },
} satisfies ExportedHandler<Env>;
