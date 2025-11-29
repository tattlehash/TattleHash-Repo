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

interface Match {
    id: string;
    mode: string;
    serverNonce: string;
    players: {
        A: { id: string; commit: string | null; revealed: { seed: string; choice: string } | null };
        B: { id: string; commit: string | null; revealed: { seed: string; choice: string } | null };
    };
    createdAt: number;
    status: string;
    expiresAt: number;
}

export async function postGameCreate(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['mode', 'players']);

        if (!Array.isArray(body.players) || body.players.length !== 2) {
            return err(400, 'GAME_BAD_INPUT', { message: 'Provide exactly two players' });
        }

        const mode = String(body.mode);
        if (!['coin', 'duel', 'rps'].includes(mode)) {
            return err(400, 'GAME_MODE', { message: 'Unsupported mode' });
        }

        const id = `match_${Math.random().toString(36).slice(2, 10)}`;
        const serverNonce = crypto.randomUUID();
        const match: Match = {
            id,
            mode,
            serverNonce,
            players: {
                A: { id: String(body.players[0]), commit: null, revealed: null },
                B: { id: String(body.players[1]), commit: null, revealed: null },
            },
            createdAt: Date.now(),
            status: 'awaiting_commits',
            expiresAt: Date.now() + 10 * 60 * 1000,
        };

        await env.TATTLEHASH_KV.put(`game:match:${id}`, JSON.stringify(match), { expirationTtl: 3600 });
        return ok({ ok: true, id, serverNonce });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}

export async function postGameCommit(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['matchId', 'player', 'commit']);

        const key = `game:match:${String(body.matchId)}`;
        const raw = await env.TATTLEHASH_KV.get(key);
        if (!raw) {
            return err(404, 'GAME_NOT_FOUND', { message: 'Match not found' });
        }

        const match = JSON.parse(raw) as Match;
        const player = String(body.player);
        if (!['A', 'B'].includes(player)) {
            return err(400, 'GAME_PLAYER', { message: 'Player must be A or B' });
        }

        match.players[player as 'A' | 'B'].commit = String(body.commit);
        match.status = 'awaiting_reveals';
        await env.TATTLEHASH_KV.put(key, JSON.stringify(match), { expirationTtl: 3600 });

        return ok({ ok: true });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}

export async function postGameReveal(req: Request, env: Env): Promise<Response> {
    try {
        const body = await safeJSON(req);
        requireFields(body, ['matchId', 'player', 'seed']);

        const key = `game:match:${String(body.matchId)}`;
        const raw = await env.TATTLEHASH_KV.get(key);
        if (!raw) {
            return err(404, 'GAME_NOT_FOUND', { message: 'Match not found' });
        }

        const match = JSON.parse(raw) as Match;
        const player = String(body.player) as 'A' | 'B';
        const choiceStr = (match.mode === 'duel' || match.mode === 'rps')
            ? String(body.choice ?? '')
            : '';

        const calcCommit = await sha256Hex(`${String(body.seed)}:${choiceStr}`);
        const expected = match.players[player].commit;

        if (expected && calcCommit !== expected) {
            return err(400, 'GAME_COMMIT_MISMATCH', { message: 'Commit mismatch' });
        }

        match.players[player].revealed = { seed: String(body.seed), choice: choiceStr };
        match.status = 'resolved';
        await env.TATTLEHASH_KV.put(key, JSON.stringify(match), { expirationTtl: 3600 });

        return ok({ ok: true, result: 'revealed' });
    } catch (e: unknown) {
        const error = e as { status?: number; code?: string; message?: string };
        return err(error.status ?? 500, error.code ?? 'INTERNAL_ERROR', { message: error.message });
    }
}
