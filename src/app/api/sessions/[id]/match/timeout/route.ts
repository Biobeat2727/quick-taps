export const runtime = 'nodejs';

import { z } from 'zod';
import { getSession, setSession } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { getMatch, setMatch, claimSeq, releaseSeq, activeActor, timeoutTurn } from '@/lib/match/match-server';
import { removePlayer } from '@/lib/session/remove-player';

const Schema = z.object({
  playerId: z.string().min(1),
  seq: z.number().int().min(0), // the shot the caller saw time out
});

// Phones fire this a beat after the deadline; allow a little clock slop.
const EARLY_TOLERANCE_MS = 750;

/** Any human at the table reports that the current turn's shot clock ran out. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const { playerId, seq } = parsed.data;

  const match = await getMatch(id);
  if (!match) return Response.json({ error: 'No match' }, { status: 404 });
  if (match.over || seq !== match.seq) return Response.json({ error: 'Stale', match }, { status: 409 });
  if (!match.players.some((p) => p.id === playerId && !p.isNpc)) return Response.json({ error: 'Not at this table' }, { status: 403 });
  if (!match.turnDeadline || Date.now() < match.turnDeadline - EARLY_TOLERANCE_MS) {
    return Response.json({ error: 'Clock still running', match: { ...match, serverNow: Date.now() } }, { status: 425 });
  }
  // One change per shot: a shot that just landed, or another phone's report, wins the race
  if (!(await claimSeq(id, match, seq))) return Response.json({ error: 'Stale' }, { status: 409 });

  const actorId = activeActor(match);
  const { match: next, dropId } = timeoutTurn(match);
  if (dropId) {
    await removePlayer(id, dropId, 'timeout');
    return Response.json({ ok: true, dropped: dropId });
  }

  try {
    await setMatch(id, next);
  } catch (err) {
    await releaseSeq(id, match, seq);
    throw err;
  }
  const session = await getSession(id);
  if (session) {
    session.lastActivity = Date.now();
    if (next.over) session.status = 'lobby';
    await setSession(session);
  }
  await ablyRest.channels.get(CHANNELS.session(id)).publish('match:update', { match: next, reason: 'timeout', actorId, now: Date.now() });
  return Response.json({ ok: true, match: next });
}
