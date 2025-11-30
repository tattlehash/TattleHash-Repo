import { ok, err } from '../../lib/http';
import { Env } from '../../types';

export async function getHealth(
    _request: Request,
    _env: Env
): Promise<Response> {
    return ok({
        status: 'healthy',
        timestamp: Date.now(),
        version: '2.0.0'
    });
}

export async function getStatus(
    _request: Request,
    env: Env
): Promise<Response> {
    try {
        // Get challenge statistics
        const challengeStats = await env.TATTLEHASH_DB
            .prepare(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM challenges
                WHERE created_at > ?
                GROUP BY status
            `)
            .bind(Date.now() - 86400000) // Last 24 hours
            .all();

        // Get webhook delivery stats
        const webhookStats = await env.TATTLEHASH_DB
            .prepare(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM webhook_deliveries
                WHERE created_at > ?
                GROUP BY status
            `)
            .bind(Date.now() - 86400000)
            .all();

        // Calculate success rate
        const delivered = (webhookStats.results?.find((r: any) => r.status === 'DELIVERED')?.count as number) || 0;
        const failed = (webhookStats.results?.find((r: any) => r.status === 'FAILED')?.count as number) || 0;
        const total = delivered + failed;
        const successRate = total > 0 ? (delivered / total) * 100 : 100;

        return ok({
            timestamp: Date.now(),
            challenges: {
                last_24h: challengeStats.results || [],
                total_active: challengeStats.results?.reduce((sum: number, r: any) => sum + r.count, 0) || 0
            },
            webhooks: {
                success_rate: successRate.toFixed(2) + '%',
                delivered,
                failed,
                pending: webhookStats.results?.find((r: any) => r.status === 'PENDING')?.count || 0
            }
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Status check error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function getMetrics(
    _request: Request,
    env: Env
): Promise<Response> {
    try {
        // Challenge creation rate (last 7 days)
        const creationRate = await env.TATTLEHASH_DB
            .prepare(`
                SELECT 
                    DATE(created_at / 1000, 'unixepoch') as date,
                    COUNT(*) as count
                FROM challenges
                WHERE created_at > ?
                GROUP BY date
                ORDER BY date DESC
            `)
            .bind(Date.now() - 86400000 * 7)
            .all();

        // Average verification time
        const avgVerification = await env.TATTLEHASH_DB
            .prepare(`
                SELECT 
                    AVG(resolved_at - created_at) as avg_time_ms
                FROM challenges
                WHERE resolved_at IS NOT NULL
                AND created_at > ?
            `)
            .bind(Date.now() - 86400000 * 7)
            .first();

        return ok({
            timestamp: Date.now(),
            creation_rate: creationRate.results || [],
            avg_verification_time_ms: avgVerification?.avg_time_ms || 0,
            avg_verification_time_hours: avgVerification?.avg_time_ms
                ? ((avgVerification.avg_time_ms as number) / 3600000).toFixed(2)
                : '0'
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Metrics error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}
