export const runtime = 'nodejs';

import { z } from 'zod';
import { getSession, setSession } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { createMatch, getMatch, setMatch } from '@/lib/match/match-server';
import type { MatchGame } from '@/types/match';

const Schema = z.object({ playerId: z.string().min(1) });

/** Host starts (or restarts, for a rematch) the session's turn-based game. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  if (session.game !== 'bowling' && session.game !== 'pool') {
    return Response.json({ error: 'Not a turn-based game' }, { status: 400 });
  }
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });

  const host = session.players.find((p) => !p.isNpc);
  if (host?.id !== parsed.data.playerId) return Response.json({ error: 'Only the host can start' }, { status: 403 });

  const existing = await getMatch(id);
  if (existing && !existing.over) return Response.json({ error: 'Match in progress' }, { status: 409 });

  const match = createMatch(session, session.game as MatchGame);
  await setMatch(id, match);

  session.status = 'playing';
  session.lastActivity = Date.now();
  await setSession(session);

  await ablyRest.channels.get(CHANNELS.session(id)).publish('match:started', { game: match.game });
  await ablyRest.channels.get(CHANNELS.sessions()).publish('session:list:updated', null);
  return Response.json(match);
}
