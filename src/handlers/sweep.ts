import { Env } from '../types';
import { ok } from '../lib/http';
import { listAnchorJobs, processOneJob } from '../anchor';

const MAX_JOBS_PER_SWEEP = 50;

export async function postSweep(_req: Request, env: Env): Promise<Response> {
    const startTime = Date.now();
    const results: Array<{ jobId: string; ok: boolean; reason?: string; txHash?: string }> = [];

    try {
        // List pending anchor jobs
        let cursor: string | undefined;
        let processed = 0;

        do {
            const list = await listAnchorJobs(env, cursor);

            for (const key of list.keys) {
                if (processed >= MAX_JOBS_PER_SWEEP) break;

                // Extract job ID from the key name (remove prefix)
                const jobId = key.name.replace(env.QUEUE_PREFIX || 'anchor:jobs:', '');

                try {
                    const result = await processOneJob(env, jobId);
                    results.push({
                        jobId,
                        ok: result.ok,
                        reason: result.reason,
                        txHash: result.txHash,
                    });
                } catch (error) {
                    results.push({
                        jobId,
                        ok: false,
                        reason: `error: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }

                processed++;
            }

            cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor && processed < MAX_JOBS_PER_SWEEP);

        const succeeded = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok).length;
        const duration = Date.now() - startTime;

        // Log sweep results
        console.log(`[sweep] processed=${processed} succeeded=${succeeded} failed=${failed} duration=${duration}ms`);

        return ok({
            ok: true,
            sweep: {
                processed,
                succeeded,
                failed,
                durationMs: duration,
                results,
            },
        });
    } catch (error) {
        console.error('[sweep] fatal error:', error);
        return ok({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            sweep: {
                processed: results.length,
                succeeded: results.filter(r => r.ok).length,
                failed: results.filter(r => !r.ok).length,
                durationMs: Date.now() - startTime,
                results,
            },
        });
    }
}
