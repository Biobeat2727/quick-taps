export const runtime = 'nodejs';

import { getSession, setSession } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { redis } from '@/lib/redis/client';
import type { BowlingGameState } from '@/types/bowling';
import { z } from 'zod';

const BOWL_STATE_TTL = 10 * 60; // 10 minutes

const StartSchema = z.object({
  playerId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

  const body = await request.json();
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });

  if (session.players[0]?.id !== parsed.data.playerId) {
    return Response.json({ error: 'Not the session creator' }, { status: 403 });
  }

  session.lastActivity = Date.now();
  await setSession(session);

  const initialState: BowlingGameState = {
    currentFrame: 0,
    currentThrow: 1,
    activePlayerId: session.players[0].id,
    pinState: Array(10).fill(true),
    throwHistory: Object.fromEntries(
      session.players.map(p => [p.id, Array.from({ length: 10 }, () => [] as number[])])
    ),
  };

  await redis.set(`qt:bowl:state:${id}`, initialState, { ex: BOWL_STATE_TTL });

  const channel = ablyRest.channels.get(CHANNELS.session(id));
  await channel.publish('bowl:started', { sessionId: id });

  return Response.json({ ok: true });
}
