import { Redis } from "@upstash/redis";

// QT_MEMORY_REDIS=1 (development only): an in-process stand-in for Upstash, so
// multiplayer can be tested locally without touching shared data. Covers just
// the commands this app uses.
function memoryRedis(): Redis {
  const kv = new Map<string, { v: unknown; exp: number }>();
  const sets = new Map<string, Set<string>>();
  const live = (k: string) => {
    const e = kv.get(k);
    if (e && e.exp && e.exp < Date.now()) { kv.delete(k); return undefined; }
    return e;
  };
  const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const impl = {
    async get<T>(k: string) { const e = live(k); return (e ? clone(e.v) : null) as T | null; },
    async set(k: string, v: unknown, opts?: { ex?: number }) {
      kv.set(k, { v: clone(v), exp: opts?.ex ? Date.now() + opts.ex * 1000 : 0 });
      return "OK";
    },
    async del(...keys: string[]) { let n = 0; for (const k of keys) n += Number(kv.delete(k) || sets.delete(k)); return n; },
    async sadd(k: string, ...m: string[]) { const s = sets.get(k) ?? new Set(); m.forEach((x) => s.add(x)); sets.set(k, s); return m.length; },
    async srem(k: string, ...m: string[]) { const s = sets.get(k); m.forEach((x) => s?.delete(x)); return m.length; },
    async smembers<T>(k: string) { return [...(sets.get(k) ?? [])] as T; },
  };
  return impl as unknown as Redis;
}

const useMemory = process.env.QT_MEMORY_REDIS === "1" && process.env.NODE_ENV !== "production";

const globalForRedis = globalThis as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ??
  (useMemory
    ? memoryRedis()
    : new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }));

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
