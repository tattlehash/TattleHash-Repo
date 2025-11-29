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

interface EnfRecord {
    baseData: unknown;
    counterparty: string;
    status: 'pending' | 'signed' | 'declined';
    createdAt: number;
    expiresAt: number;
    hash?: string;
}

export async function postEnfInit(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['data', 'counterparty']);

        const id = `enf_${Math.random().toString(36).slice(2, 12)}`;
        const expiryMs = Number(body.expiryMs ?? 24 * 3600 * 1000);

        const record: EnfRecord = {
            baseData: body.data,
            counterparty: String(body.counterparty),
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + expiryMs,
        };

        await env.TATTLEHASH_KV.put(
            `enf:${id}`,
            JSON.stringify(record),
            { expirationTtl: Math.ceil(expiryMs / 1000) + 60 }
        );

        return ok({ ok: true, id, expiresInMs: expiryMs });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}

export async function postEnfAction(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['id', 'action']);

        const recKey = `enf:${body.id}`;
        const raw = await env.TATTLEHASH_KV.get(recKey);

        if (!raw) {
            return err(404, 'ENF_NOT_FOUND', { message: 'ENF not found' });
        }

        const rec = JSON.parse(raw) as EnfRecord;
        const action = String(body.action);

        if (action === 'sign') {
            const dataToHash = {
                ...(rec.baseData && typeof rec.baseData === 'object' ? rec.baseData : {}),
                counterpartySig: body.signature ?? 'ack',
            };
            const hash = await sha256Hex(JSON.stringify(dataToHash));
            rec.status = 'signed';
            rec.hash = hash;
            await env.TATTLEHASH_KV.put(recKey, JSON.stringify(rec), { expirationTtl: 900 });
            return ok({ ok: true, code: 'ENF_SIGNED', hash });
        }

        if (action === 'decline') {
            rec.status = 'declined';
            await env.TATTLEHASH_KV.put(recKey, JSON.stringify(rec), { expirationTtl: 900 });
            return ok({ ok: true, code: 'ENF_DECLINED' });
        }

        return err(400, 'ENF_BAD_INPUT', { message: 'Unknown ENF action' });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}
