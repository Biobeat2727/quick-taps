export const runtime = 'nodejs';

import { getSession } from '@/lib/redis/session';
import { simulateBowl } from '@/lib/physics/simulate-bowling';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { redis } from '@/lib/redis/client';
import { nextTurn, isGameComplete, computeFrameScores } from '@/lib/bowling/bowling-logic';
import type { BowlingGameState } from '@/types/bowling';
import { z } from 'zod';

const BOWL_STATE_TTL = 10 * 60; // 10 minutes

const BowlSchema = z.object({
  playerId: z.string().min(1),
  params: z.object({
    startX:    z.number(),
    direction: z.number(),
    power:     z.number().min(0).max(1),
    spin:      z.number().min(-1).max(1),
    pinState:  z.array(z.boolean()).length(10),
  }),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = await redis.get<BowlingGameState>(`qt:bowl:state:${id}`);
  if (!state) return Response.json({ error: 'Game not found' }, { status: 404 });
  return Response.json(state);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

  const body = await request.json();
  const parsed = BowlSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });

  const { playerId, params: throwParams } = parsed.data;

  const state = await redis.get<BowlingGameState>(`qt:bowl:state:${id}`);
  if (!state) return Response.json({ error: 'Game not found' }, { status: 404 });

  if (state.activePlayerId !== playerId) {
    return Response.json({ error: 'Not your turn' }, { status: 403 });
  }

  const playerIds = session.players.map(p => p.id);

  // Compute monotonic throw index from throw history
  const throwIndex = playerIds.reduce((sum, pid) => {
    const frames = state.throwHistory[pid] ?? [];
    return sum + frames.reduce((s, f) => s + f.length, 0);
  }, 0);

  // Use server-side pinState (authoritative), override any client-provided value
  const recording = await simulateBowl({ ...throwParams, pinState: state.pinState });

  const newState = nextTurn(state, recording.knockedPins, playerIds);
  await redis.set(`qt:bowl:state:${id}`, newState, { ex: BOWL_STATE_TTL });

  await redis.set(`qt:bowl:recording:${id}:${throwIndex}`, recording, { ex: 600 });

  const channel = ablyRest.channels.get(CHANNELS.session(id));
  await channel.publish('bowl:throw', {
    playerId,
    throwIndex,
    knockedPins: recording.knockedPins,
    gameState: newState,
  });

  if (isGameComplete(newState, playerIds)) {
    const finalScores = Object.fromEntries(
      playerIds.map(pid => {
        const frames = newState.throwHistory[pid] ?? [];
        const scores = computeFrameScores(frames.flat());
        return [pid, scores[9] ?? 0];
      })
    );
    await channel.publish('bowl:game:over', { finalScores });
  }

  return Response.json({ ok: true });
}
