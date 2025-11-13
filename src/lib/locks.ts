export async function withGlobalAnchorLock<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  const lock = env.AnchorLock.get(env.AnchorLock.idFromName("anchor-global"));
  const got = await lock.fetch("https://lock/do", { method: "POST" });
  if (!got.ok) throw new Error("lock_acquire_failed");
  try { return await fn(); }
  finally { await lock.fetch("https://lock/release", { method: "POST" }); }
}
