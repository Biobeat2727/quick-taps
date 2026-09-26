import { z } from 'zod';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { createSession } from '@/lib/session/create-session';
import { MARBLE_COLORS } from '@/lib/constants';

const Schema = z.object({
  fromId: z.string().min(1).max(64),   // challenger's device id (Ably clientId)
  fromName: z.string().min(1).max(32),
  toId: z.string().min(1).max(64),
  game: z.enum(['marble_race', 'bowling', 'pool']),
});

const CHALLENGE_TTL_MS = 45_000;

/**
 * Challenge someone at the bar: opens a table with the challenger as host and
 * drops an invite in the other person's inbox. Returns the table so the
 * challenger can walk straight to it.
 */
export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const { fromId, fromName, toId, game } = parsed.data;
  if (fromId === toId) return Response.json({ error: "Can't challenge yourself" }, { status: 400 });

  const session = await createSession(game, fromName, MARBLE_COLORS[0].hex);
  await ablyRest.channels.get(CHANNELS.inbox(toId)).publish('challenge', {
    sessionId: session.id, game, fromId, fromName, expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return Response.json({ session, player: session.players[0] }, { status: 201 });
}
