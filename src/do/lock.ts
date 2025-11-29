/**
 * AnchorLock - Durable Object for distributed locking during anchor operations.
 *
 * Uses DO's single-threaded execution model combined with storage-based
 * lock state to prevent concurrent anchoring from multiple cron invocations.
 *
 * Lock automatically expires after LOCK_TIMEOUT_MS to prevent deadlocks.
 */

const LOCK_TIMEOUT_MS = 60_000; // 60 second lock timeout

interface LockState {
  holder: string;
  acquiredAt: number;
  expiresAt: number;
}

export class AnchorLock {
  state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Acquire lock
    if (url.pathname === '/do' && req.method === 'POST') {
      return this.acquireLock(req);
    }

    // Release lock
    if (url.pathname === '/release' && req.method === 'POST') {
      return this.releaseLock(req);
    }

    // Get lock status
    if (url.pathname === '/status' && req.method === 'GET') {
      return this.getLockStatus();
    }

    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async acquireLock(req: Request): Promise<Response> {
    const now = Date.now();

    // Get current lock state
    const currentLock = await this.state.storage.get<LockState>('lock');

    // Check if there's an active lock that hasn't expired
    if (currentLock && currentLock.expiresAt > now) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: 'lock_held',
          holder: currentLock.holder,
          expiresIn: currentLock.expiresAt - now,
        }),
        {
          status: 409, // Conflict
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate a unique holder ID for this lock request
    const holderId = `sweep-${now}-${Math.random().toString(36).slice(2, 8)}`;

    // Acquire the lock
    const newLock: LockState = {
      holder: holderId,
      acquiredAt: now,
      expiresAt: now + LOCK_TIMEOUT_MS,
    };

    await this.state.storage.put('lock', newLock);

    // Set an alarm to auto-expire the lock (backup for cleanup)
    await this.state.storage.setAlarm(newLock.expiresAt);

    return new Response(
      JSON.stringify({
        ok: true,
        holder: holderId,
        expiresAt: newLock.expiresAt,
        ttlMs: LOCK_TIMEOUT_MS,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  private async releaseLock(_req: Request): Promise<Response> {
    // Simply delete the lock - in production you might want to verify the holder
    await this.state.storage.delete('lock');

    return new Response(
      JSON.stringify({ ok: true, released: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  private async getLockStatus(): Promise<Response> {
    const now = Date.now();
    const currentLock = await this.state.storage.get<LockState>('lock');

    if (!currentLock || currentLock.expiresAt <= now) {
      return new Response(
        JSON.stringify({ locked: false }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        locked: true,
        holder: currentLock.holder,
        acquiredAt: currentLock.acquiredAt,
        expiresAt: currentLock.expiresAt,
        remainingMs: currentLock.expiresAt - now,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Alarm handler - auto-cleanup expired locks
  async alarm(): Promise<void> {
    const now = Date.now();
    const currentLock = await this.state.storage.get<LockState>('lock');

    if (currentLock && currentLock.expiresAt <= now) {
      await this.state.storage.delete('lock');
      console.log(`[AnchorLock] Auto-released expired lock from ${currentLock.holder}`);
    }
  }
}
