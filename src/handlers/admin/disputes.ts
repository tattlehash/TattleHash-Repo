import { ok, err } from '../../lib/http';
import { query, queryOne, execute } from '../../db';
import { createError } from '../../errors';
import { resolveDispute as resolveFireDispute } from '../../gatekeeper/modes/fire';
import { Env } from '../../types';

interface Dispute {
    id: string;
    challenge_id: string;
    raised_by_user_id: string;
    reason: string;
    evidence: string;
    status: 'PENDING' | 'RESOLVED';
    winner_user_id?: string;
    resolution?: string;
    resolved_at?: number;
    created_at: number;
}

export async function listDisputes(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'PENDING';

    try {
        const disputes = await query<Dispute>(
            env.TATTLEHASH_DB,
            `SELECT * FROM challenge_disputes 
             WHERE status = ? 
             ORDER BY created_at DESC 
             LIMIT 100`,
            [status]
        );

        return ok({ disputes });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('List disputes error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function getDispute(
    request: Request,
    env: Env,
    disputeId: string
): Promise<Response> {
    try {
        const dispute = await queryOne<Dispute>(
            env.TATTLEHASH_DB,
            'SELECT * FROM challenge_disputes WHERE id = ?',
            [disputeId]
        );

        if (!dispute) {
            return err(404, 'NOT_FOUND', { message: 'Dispute not found' });
        }

        // Get associated challenge
        const challenge = await queryOne(
            env.TATTLEHASH_DB,
            'SELECT * FROM challenges WHERE id = ?',
            [dispute.challenge_id]
        );

        // Parse evidence JSON
        let evidence = {};
        try {
            evidence = JSON.parse(dispute.evidence);
        } catch {
            evidence = { raw: dispute.evidence };
        }

        return ok({
            dispute: {
                ...dispute,
                evidence
            },
            challenge
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Get dispute error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function postResolveDispute(
    request: Request,
    env: Env,
    disputeId: string
): Promise<Response> {
    try {
        const body = await request.json() as {
            winner_user_id: string;
            resolution: string;
        };

        if (!body.winner_user_id || !body.resolution) {
            return err(400, 'VALIDATION_ERROR', {
                message: 'winner_user_id and resolution are required'
            });
        }

        // Get dispute
        const dispute = await queryOne<Dispute>(
            env.TATTLEHASH_DB,
            'SELECT * FROM challenge_disputes WHERE id = ?',
            [disputeId]
        );

        if (!dispute) {
            return err(404, 'NOT_FOUND', { message: 'Dispute not found' });
        }

        if (dispute.status !== 'PENDING') {
            return err(400, 'VALIDATION_ERROR', {
                message: 'Dispute already resolved'
            });
        }

        // Get challenge to verify mode
        const challenge = await queryOne<any>(
            env.TATTLEHASH_DB,
            'SELECT * FROM challenges WHERE id = ?',
            [dispute.challenge_id]
        );

        if (!challenge) {
            throw createError('CHALLENGE_NOT_FOUND');
        }

        // Use FIRE mode resolution if applicable
        if (challenge.mode === 'FIRE') {
            await resolveFireDispute(
                env,
                dispute.challenge_id,
                body.winner_user_id,
                `[ADMIN] ${body.resolution}`
            );
        } else {
            // Manual resolution for other modes
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenge_disputes 
                 SET status = ?, winner_user_id = ?, resolution = ?, resolved_at = ?
                 WHERE id = ?`,
                ['RESOLVED', body.winner_user_id, body.resolution, Date.now(), disputeId]
            );

            // Update challenge status
            await execute(
                env.TATTLEHASH_DB,
                `UPDATE challenges 
                 SET status = ?, resolved_at = ?, updated_at = ?
                 WHERE id = ?`,
                ['COMPLETED', Date.now(), Date.now(), dispute.challenge_id]
            );
        }

        // Emit event
        const { emitEvent } = await import('../../relay/events');
        await emitEvent(env, {
            type: 'dispute.resolved',
            dispute_id: disputeId,
            challenge_id: dispute.challenge_id,
            winner_user_id: body.winner_user_id,
            resolved_by: 'admin'
        });

        return ok({
            message: 'Dispute resolved successfully',
            dispute_id: disputeId,
            winner: body.winner_user_id
        });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'code' in e) {
            const error = createError((e as any).code, (e as any).details);
            return err(error.status, error.code, { message: error.message, ...(e as any).details });
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        console.error('Resolve dispute error:', message);
        return err(500, 'INTERNAL_ERROR', { message });
    }
}

export async function handleDisputes(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // /admin/disputes
    if (pathParts.length === 2 && request.method === 'GET') {
        return listDisputes(request, env);
    }

    // /admin/disputes/:id
    if (pathParts.length === 3 && request.method === 'GET') {
        return getDispute(request, env, pathParts[2]);
    }

    // /admin/disputes/:id/resolve
    if (pathParts.length === 4 && pathParts[3] === 'resolve' && request.method === 'POST') {
        return postResolveDispute(request, env, pathParts[2]);
    }

    return err(404, 'ROUTE_NOT_FOUND');
}
