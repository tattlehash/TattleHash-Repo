import { createError } from '../errors';
import { Env } from '../types';

export interface AdminContext {
    isAdmin: boolean;
    adminId?: string;
}

export async function requireAdmin(
    request: Request,
    env: Env
): Promise<{ ok: true; adminId: string } | { ok: false; response: Response }> {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const error = createError('UNAUTHORIZED', { message: 'Missing or invalid Authorization header' });
        return {
            ok: false,
            response: new Response(JSON.stringify({ error: error.message }), {
                status: error.status,
                headers: { 'Content-Type': 'application/json' }
            })
        };
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        const error = createError('FORBIDDEN', { message: 'Invalid admin credentials' });
        return {
            ok: false,
            response: new Response(JSON.stringify({ error: error.message }), {
                status: error.status,
                headers: { 'Content-Type': 'application/json' }
            })
        };
    }

    // Log admin action for audit trail
    await logAdminAction(request, env, 'admin-system');

    return { ok: true, adminId: 'admin-system' };
}

async function logAdminAction(request: Request, env: Env, adminId: string): Promise<void> {
    const url = new URL(request.url);
    const logEntry = {
        timestamp: Date.now(),
        admin_id: adminId,
        method: request.method,
        path: url.pathname,
        ip: request.headers.get('CF-Connecting-IP') || 'unknown',
    };

    // Store in KV with 90-day retention
    await env.GATE_KV.put(
        `admin_log:${Date.now()}:${crypto.randomUUID()}`,
        JSON.stringify(logEntry),
        { expirationTtl: 86400 * 90 }
    );
}
