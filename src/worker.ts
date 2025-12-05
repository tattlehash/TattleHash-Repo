import { route } from "./router";
import { postSweep } from "./handlers/sweep";
import { handleQueueMessage } from "./handlers/queue";
import { processDowngrades } from "./gatekeeper/modes/downgrade";
import { expireCredits, expireHolds } from "./credits/core";
import { Env } from "./types";

export { AnchorLock } from "./do/lock";

export default {
  fetch: (req: Request, env: Env, _ctx: ExecutionContext) => route(req, env),

  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    const startTime = Date.now();

    // Run all scheduled tasks in parallel
    const results = await Promise.allSettled([
      // Cron-driven background anchoring
      postSweep(new Request("https://internal/sweep", { method: "POST" }), env),

      // Auto-downgrade expired GATEKEEPER/ENFORCED challenges to FIRE
      processDowngrades(env),

      // Expire stale credits and holds
      expireCredits(env),
      expireHolds(env),
    ]);

    // Log summary
    const duration = Date.now() - startTime;
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(JSON.stringify({
      t: Date.now(),
      at: 'scheduled_sweep_complete',
      tasks_succeeded: succeeded,
      tasks_failed: failed,
      duration_ms: duration,
    }));

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const taskNames = ['anchor_sweep', 'downgrades', 'expire_credits', 'expire_holds'];
        console.error(`Scheduled task ${taskNames[index]} failed:`, result.reason);
      }
    });
  },

  queue: async (batch: MessageBatch, env: Env) => {
    await handleQueueMessage(batch, env);
  },
} satisfies ExportedHandler<Env>;
