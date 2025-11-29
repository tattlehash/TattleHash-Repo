
import { D1Database } from '@cloudflare/workers-types';





export async function query<T = any>(
    db: D1Database,
    sql: string,
    params: any[] = []
): Promise<T[]> {
    const stmt = db.prepare(sql).bind(...params);
    const { results } = await stmt.all();
    return results as T[];
}

export async function queryOne<T = any>(
    db: D1Database,
    sql: string,
    params: any[] = []
): Promise<T | null> {
    const results = await query<T>(db, sql, params);
    return results.length > 0 ? results[0] : null;
}

export async function execute(
    db: D1Database,
    sql: string,
    params: any[] = []
): Promise<void> {
    const stmt = db.prepare(sql).bind(...params);
    await stmt.run();
}
