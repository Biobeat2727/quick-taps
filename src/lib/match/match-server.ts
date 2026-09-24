// Server-side match logic. Pure except for the Redis helpers at the bottom.

import { redis } from '@/lib/redis/client';
import { nextTurn, isGameComplete } from '@/lib/bowling/bowling-logic';
import { newGame, applyShot, canPlaceCue } from '@/lib/pool/pool-rules';
import type { PoolSimResult } from '@/lib/pool/pool-sim-core';
import type { Session } from '@/types/session';
import type { BowlingGameState } from '@/types/bowling';
import type {
  Match, MatchGame, MatchPlayer, BowlShotPayload, PoolShotPayload, BowlRecording, PoolRecording,
} from '@/types/match';
import { NPC_NAMES } from '@/lib/constants';

const TTL = 30 * 60; // a match outlives a long 10 frames with slack
const matchKey = (id: string) => `qt:match:${id}`;
const recKey = (id: string, seq: number) => `qt:match:rec:${id}:${seq}`;

export const MAX_PLAYERS: Record<MatchGame, number> = { bowling: 6, pool: 2 };

// ── Start ────────────────────────────────────────────────────────────────────

export function createMatch(session: Session, game: MatchGame): Match {
  const humans: MatchPlayer[] = session.players
    .filter((p) => !p.isNpc)
    .slice(0, MAX_PLAYERS[game])
    .map((p) => ({ id: p.id, name: p.name, color: p.color, isNpc: false }));
  const hostId = humans[0].id;
  const base = { hostId, seq: 0, over: false, startedAt: Date.now() };

  if (game === 'pool') {
    const players = [...humans];
    if (players.length === 1) {
      // Solo at the table: an NPC regular racks up against you
      const name = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)];
      players.push({ id: `npc:${name}`, name, color: '#b44bff', isNpc: true });
    }
    return { ...base, game, players, state: newGame(Math.floor(Math.random() * 1e9), 0) };
  }

  const state: BowlingGameState = {
    currentFrame: 0,
    currentThrow: 1,
    activePlayerId: humans[0].id,
    pinState: Array(10).fill(true),
    throwHistory: Object.fromEntries(humans.map((p) => [p.id, Array.from({ length: 10 }, () => [] as number[])])),
  };
  return { ...base, game, players: humans, state };
}

// ── Whose turn ───────────────────────────────────────────────────────────────

export function activeActor(m: Match): string {
  return m.game === 'bowling' ? m.state.activePlayerId : m.players[m.state.turn].id;
}

/** May `submitterId` submit a shot for the current actor? (Hosts play the NPC's turns.) */
export function maySubmit(m: Match, submitterId: string): boolean {
  const actor = activeActor(m);
  if (actor === submitterId) return true;
  const p = m.players.find((q) => q.id === actor);
  return !!p?.isNpc && submitterId === m.hostId;
}

// ── Apply a shot ─────────────────────────────────────────────────────────────

export function applyBowl(m: Extract<Match, { game: 'bowling' }>, shot: BowlShotPayload): Match {
  // A throw can only knock down pins that were standing
  const knocked = shot.knocked.map((k, i) => k && m.state.pinState[i]);
  const ids = m.players.map((p) => p.id);
  const state = nextTurn(m.state, knocked, ids);
  return { ...m, state, seq: m.seq + 1, over: isGameComplete(state, ids) };
}

export function applyPool(m: Extract<Match, { game: 'pool' }>, p: PoolShotPayload): Match | { error: string } {
  const s = m.state;
  let table = s.table;
  if (p.cue) {
    if (!s.ballInHand) return { error: 'No ball in hand' };
    if (!canPlaceCue(s, p.cue[0], p.cue[1])) return { error: 'Bad cue placement' };
    table = { ...table, pos: table.pos.map((q, i) => (i === 0 ? p.cue! : q)) as [number, number][] };
  }
  const sim: PoolSimResult = {
    numFrames: p.rec.numFrames,
    frames: new Float32Array(0),
    pocketedAt: p.rec.pocketedAt,
    pocketOf: p.rec.pocketOf,
    firstHit: p.firstHit,
    railAfterContact: p.railAfterContact,
    final: p.final,
    events: [],
  };
  const state = applyShot({ ...s, table }, sim);
  return { ...m, state, seq: m.seq + 1, over: state.winner !== null };
}

// ── Players leaving mid-match ────────────────────────────────────────────────

export function dropPlayer(m: Match, playerId: string): Match | null {
  const idx = m.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || m.over) return null;

  if (m.game === 'pool') {
    // Walking away from the table concedes the rack
    const winner = idx === 0 ? 1 : 0;
    return { ...m, over: true, state: { ...m.state, winner, lastCall: { kind: 'win', reason: 'eight' } } };
  }

  const players = m.players.filter((p) => p.id !== playerId);
  if (!players.length) return { ...m, players, over: true };
  let state = m.state;
  if (state.activePlayerId === playerId) {
    // Hand the lane to whoever was next; wrapping past the end starts the next frame
    const next = idx < players.length ? players[idx] : players[0];
    const wrapped = idx >= players.length;
    state = {
      ...state,
      activePlayerId: next.id,
      currentFrame: wrapped ? state.currentFrame + 1 : state.currentFrame,
      currentThrow: 1,
      pinState: Array(10).fill(true),
    };
  }
  const hostId = players.find((p) => !p.isNpc)?.id ?? m.hostId;
  const over = isGameComplete(state, players.map((p) => p.id));
  return { ...m, players, hostId, state, over };
}

// ── Redis ────────────────────────────────────────────────────────────────────

export async function getMatch(id: string): Promise<Match | null> {
  return redis.get<Match>(matchKey(id));
}
export async function setMatch(id: string, m: Match): Promise<void> {
  await redis.set(matchKey(id), m, { ex: TTL });
}
export async function setRecording(id: string, seq: number, rec: BowlRecording | PoolRecording): Promise<void> {
  await redis.set(recKey(id, seq), rec, { ex: 15 * 60 });
}
export async function getRecording(id: string, seq: number) {
  return redis.get<BowlRecording | PoolRecording>(recKey(id, seq));
}
