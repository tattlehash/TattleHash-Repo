import { Env } from '../types';
import type { Challenge } from '../gatekeeper/challenges/types';

const CACHE_TTL = 300; // 5 minutes

export async function getCachedChallenge(
    env: Env,
    id: string
): Promise<Challenge | null> {
    const cacheKey = `cache:challenge:${id}`;

    // Try to get from cache
    const cached = await env.GATE_KV.get(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached) as Challenge;
        } catch {
            // Invalid cache, continue to database
        }
    }

    return null;
}

export async function setCachedChallenge(
    env: Env,
    challenge: Challenge
): Promise<void> {
    const cacheKey = `cache:challenge:${challenge.id}`;

    await env.GATE_KV.put(
        cacheKey,
        JSON.stringify(challenge),
        { expirationTtl: CACHE_TTL }
    );
}

export async function invalidateChallengeCache(
    env: Env,
    id: string
): Promise<void> {
    const cacheKey = `cache:challenge:${id}`;
    await env.GATE_KV.delete(cacheKey);
}

export async function getCachedWebhookSubscriptions(
    env: Env
): Promise<any[] | null> {
    const cacheKey = 'cache:webhooks:active';

    const cached = await env.GATE_KV.get(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch {
            return null;
        }
    }

    return null;
}

export async function setCachedWebhookSubscriptions(
    env: Env,
    subscriptions: any[]
): Promise<void> {
    const cacheKey = 'cache:webhooks:active';

    await env.GATE_KV.put(
        cacheKey,
        JSON.stringify(subscriptions),
        { expirationTtl: 60 } // 1 minute for webhooks
    );
}
