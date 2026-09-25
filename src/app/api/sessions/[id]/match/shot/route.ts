export const runtime = 'nodejs';

import { z } from 'zod';
import { getSession, setSession } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import {
  getMatch, setMatch, setRecording, maySubmit, activeActor, applyBowl, applyPool, claimSeq, releaseSeq,
} from '@/lib/match/match-server';
import type { BowlShotPayload, Match, PoolShotPayload } from '@/types/match';

const b64 = z.string().max(600_000);
const vec = z.tuple([z.number(), z.number()]);

const Bowl = z.object({
  knocked: z.array(z.boolean()).length(10),
  speed: z.number(),
  spin: z.number(),
  rec: z.object({
    numFrames: z.number().int().min(1).max(2000), ball: b64, pins: b64, impactFrame: z.number().int(), gutterFrame: z.number().int(),
    knocked: z.array(z.boolean()).length(10), speed: z.number(), spin: z.number(),
  }),
});

const Pool = z.object({
  cue: vec.nullable(),
  shot: z.object({ angle: z.number(), speed: z.number().min(0).max(10), spin: z.number().min(-1).max(1), side: z.number().min(-1).max(1).optional() }),
  firstHit: z.number().int().min(-1).max(15),
  railAfterContact: z.boolean(),
  final: z.object({ pos: z.array(vec).length(16), active: z.array(z.boolean()).length(16) }),
  rec: z.object({
    numFrames: z.number().int().min(1).max(2000),
    frames: b64,
    pocketedAt: z.array(z.number().int()).length(16),
    pocketOf: z.array(z.number().int()).length(16),
    events: z.array(z.any()).max(2000),
  }),
});

const Schema = z.object({
  playerId: z.string().min(1),
  seq: z.number().int().min(0),       // the shot index the client thinks it's taking
  payload: z.unknown(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const { playerId, seq, payload } = parsed.data;

  const match = await getMatch(id);
  if (!match) return Response.json({ error: 'No match' }, { status: 404 });
  if (match.over) return Response.json({ error: 'Match over' }, { status: 409 });
  // Stale or duplicate submit (double tap, retry after a timeout)
  if (seq !== match.seq) return Response.json({ error: 'Out of turn', match }, { status: 409 });
  if (!maySubmit(match, playerId)) return Response.json({ error: 'Not your turn', match }, { status: 403 });

  const actorId = activeActor(match);
  let next: Match;
  let rec;
  if (match.game === 'bowling') {
    const p = Bowl.safeParse(payload);
    if (!p.success) return Response.json({ error: 'Bad bowling payload' }, { status: 400 });
    next = applyBowl(match, p.data as BowlShotPayload);
    rec = p.data.rec;
  } else {
    const p = Pool.safeParse(payload);
    if (!p.success) return Response.json({ error: 'Bad pool payload' }, { status: 400 });
    const r = applyPool(match, p.data as PoolShotPayload);
    if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
    next = r;
    rec = p.data.rec;
  }

  // One change per shot: a double submit, or the shot clock expiring at the same moment
  if (!(await claimSeq(id, match, seq))) return Response.json({ error: 'Out of turn' }, { status: 409 });

  try {
    await setRecording(id, seq, rec);
    await setMatch(id, next);
  } catch (err) {
    await releaseSeq(id, match, seq);
    throw err;
  }

  const session = await getSession(id);
  if (session) {
    session.lastActivity = Date.now();
    if (next.over) session.status = 'lobby'; // table's free for new players between games
    await setSession(session);
  }

  await ablyRest.channels.get(CHANNELS.session(id)).publish('match:shot', { seq, actorId, match: next, now: Date.now() });
  return Response.json({ ok: true, match: next });
}
