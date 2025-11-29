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

interface PofRecord {
    minAmountUSD: number;
    chain: string;
    asset: string;
    status: 'pending' | 'verified' | 'failed';
    createdAt: number;
    verifiedAt?: number;
    failedAt?: number;
    address?: string;
}

// Placeholder - replace with real implementation
async function verifyAddressOwnership(
    _chain: string,
    _address: string,
    _challenge: string,
    _signature: string,
    _env: Env
): Promise<boolean> {
    // TODO: Implement real signature verification
    return true;
}

// Placeholder - replace with real implementation
async function getBalanceInUSD(
    _chain: string,
    _asset: string,
    _address: string,
    _env: Env
): Promise<number> {
    // TODO: Implement real balance fetching via RPC
    return 123.45;
}

async function sendWebhook(env: Env, event: string, payload: unknown): Promise<void> {
    await env.TATTLEHASH_ERROR_KV.put(
        `webhook:${event}:${Date.now()}`,
        JSON.stringify(payload),
        { expirationTtl: 3600 }
    );
}

export async function postPofInit(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['minAmountUSD', 'chain']);

        if (typeof body.minAmountUSD !== 'number') {
            return err(400, 'POF_BAD_INPUT', { message: 'minAmountUSD must be number' });
        }

        const token = crypto.randomUUID();
        const record: PofRecord = {
            minAmountUSD: body.minAmountUSD,
            chain: String(body.chain).toLowerCase(),
            asset: String(body.asset ?? 'USDT').toUpperCase(),
            status: 'pending',
            createdAt: Date.now(),
        };

        await env.TATTLEHASH_KV.put(
            `pof:${token}`,
            JSON.stringify(record),
            { expirationTtl: 3600 }
        );

        return ok({ ok: true, token });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}

export async function postPofPost(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['token', 'address', 'signature', 'challenge']);

        const raw = await env.TATTLEHASH_KV.get(`pof:${body.token}`);
        if (!raw) {
            return err(404, 'POF_NOT_FOUND', { message: 'Token not found' });
        }

        const rec = JSON.parse(raw) as PofRecord;

        const sigOk = await verifyAddressOwnership(
            rec.chain,
            String(body.address),
            String(body.challenge),
            String(body.signature),
            env
        );

        if (!sigOk) {
            return err(401, 'POF_SIG', { message: 'Signature invalid' });
        }

        const usd = await getBalanceInUSD(rec.chain, rec.asset, String(body.address), env).catch(() => null);

        if (usd !== null && usd >= rec.minAmountUSD) {
            rec.status = 'verified';
            rec.verifiedAt = Date.now();
            rec.address = String(body.address);
            await env.TATTLEHASH_KV.put(`pof:${body.token}`, JSON.stringify(rec), { expirationTtl: 3600 });

            const attId = `att-${Date.now()}`;
            const leafHash = await sha256Hex(attId + String(body.address) + usd);
            await sendWebhook(env, 'pof.verified', {
                attestationId: attId,
                address: String(body.address),
                usd,
                leafHash,
            });

            return ok({ ok: true, verified: true, usd });
        } else {
            rec.status = 'failed';
            rec.failedAt = Date.now();
            rec.address = String(body.address);
            await env.TATTLEHASH_KV.put(`pof:${body.token}`, JSON.stringify(rec), { expirationTtl: 3600 });

            return ok({ ok: true, verified: false, usd });
        }
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}
