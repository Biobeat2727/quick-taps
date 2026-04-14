import { redis } from "./client";
import type { Session } from "@/types/session";

const SESSION_TTL_SECONDS = 10 * 60; // 10 minutes
const INDEX_KEY = "qt:sessions";

function sessionKey(id: string) {
  return `qt:session:${id}`;
}

export async function getSession(id: string): Promise<Session | null> {
  return redis.get<Session>(sessionKey(id));
}

export async function setSession(session: Session): Promise<void> {
  await redis.set(sessionKey(session.id), session, { ex: SESSION_TTL_SECONDS });
}

export async function deleteSession(id: string): Promise<void> {
  await redis.del(sessionKey(id));
}

export async function addSessionToIndex(id: string): Promise<void> {
  await redis.sadd(INDEX_KEY, id);
}

export async function removeSessionFromIndex(id: string): Promise<void> {
  await redis.srem(INDEX_KEY, id);
}

export async function listSessions(): Promise<Session[]> {
  const ids = await redis.smembers<string[]>(INDEX_KEY);
  if (!ids.length) return [];

  const sessions = await Promise.all(ids.map((id) => getSession(id)));
  const valid = sessions.filter((s): s is Session => s !== null);

  // Prune expired entries from the index
  const expired = ids.filter((_, i) => sessions[i] === null);
  if (expired.length) {
    await Promise.all(expired.map((id) => removeSessionFromIndex(id)));
  }

  return valid;
}
