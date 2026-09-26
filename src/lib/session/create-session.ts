// Create a table with its first (host) player — the Start button and challenges.

import { randomUUID } from 'crypto';
import { setSession, addSessionToIndex } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import type { GameId, Session } from '@/types/session';

export async function createSession(game: GameId, playerName: string, playerColor: string): Promise<Session> {
  const now = Date.now();
  const session: Session = {
    id: randomUUID(),
    game,
    createdAt: now,
    lastActivity: now,
    players: [{ id: randomUUID(), name: playerName, color: playerColor, isNpc: false }],
  };
  await setSession(session);
  await addSessionToIndex(session.id);
  await ablyRest.channels.get(CHANNELS.sessions()).publish('session:list:updated', null);
  return session;
}
