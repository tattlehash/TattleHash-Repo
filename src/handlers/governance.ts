import { ok, err } from '../lib/http';
import { Env } from '../types';

type JsonDict = Record<string, unknown>;

async function sha256Hex(input: string): Promise<string> {
    const enc = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function safeJSON(req: Request, maxBytes = 512 * 1024): Promise<JsonDict> {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    const clone = req.clone();
    const buf = await clone.arrayBuffer();
    if (buf.byteLength > maxBytes) {
        throw { message: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', status: 413 };
    }
    const j: unknown = await req.json().catch(() => ({}));
    return j && typeof j === 'object' ? (j as JsonDict) : {};
}

function requireFields<T extends string>(obj: JsonDict, fields: T[]): void {
    for (const f of fields) {
        if (obj[f] === undefined || obj[f] === null) {
            throw { message: `Missing ${f}`, code: 'BAD_INPUT', status: 400 };
        }
    }
}

export async function postGovernanceUpdate(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['policyUpdate']);

        const payloadHash = await sha256Hex(JSON.stringify(body.policyUpdate));

        await env.TATTLEHASH_QUEUE.send({
            type: 'governance',
            payload: {
                policyUpdate: body.policyUpdate,
                payloadHash,
            },
        });

        return ok({ ok: true, payloadHash });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}
