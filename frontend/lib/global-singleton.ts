/**
 * Cache a value on `globalThis` so it survives Next.js dev hot-reloads.
 *
 * In dev, Next re-evaluates server modules on every change. A plain
 * module-level singleton would be recreated on each reload, leaking the old
 * one (a dangling DB/LISTEN/S3 connection per save). Stashing it on the global
 * object — which persists across reloads — keeps exactly one instance per
 * process. In prod, modules load once, so this is just a one-time create.
 *
 * Use a unique, prefixed `key` per singleton to avoid collisions. For values
 * that need invalidation (e.g. a TTL'd client), store a mutable holder object
 * and mutate its fields:
 *
 *   const cache = globalSingleton("clickhouse",
 *     () => ({ client: undefined as Client | undefined, createdAt: 0 }));
 */
const store = globalThis as unknown as Record<string, unknown>;

export function globalSingleton<T>(key: string, make: () => T): T {
  store[`__plexus_${key}`] ??= make();
  return store[`__plexus_${key}`] as T;
}
