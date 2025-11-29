
import { Env } from '../types';

export async function enqueue(env: Env, job: any): Promise<void> {
    // Stub implementation
    if (env.TATTLEHASH_QUEUE) {
        await env.TATTLEHASH_QUEUE.send(job);
    }
}
