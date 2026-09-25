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
import { SHOT_CLOCK_MS } from './shot-clock';

const TTL = 30 * 60; // a match outlives a long 10 frames with slack
const matchKey = (id: string) => `qt:match:${id}`;
const recKey = (id: string, seq: number) => `qt:match:rec:${id}:${seq}`;

export const MAX_PLAYERS: Record<MatchGame, number> = { bowling: 6, pool: 2 };

// ── Shot clock ───────────────────────────────────────────────────────────────
// A human turn times out SHOT_CLOCK after the previous shot has had time to
// replay on everyone's phone (REPLAY_ALLOW). Other players' phones then call
// the timeout route; MAX_TIMEOUTS in a row drops the player from the match.

const REPLAY_ALLOW_MS: Record<MatchGame, number> = { bowling: 9_000, pool: 8_000 };
export const MAX_TIMEOUTS = 2;

/** Set the deadline for whoever's turn it now is. */
export function stampTurn<M extends Match>(m: M, allowMs: number): M {
  const actor = m.players.find((p) => p.id === activeActor(m));
  if (m.over || !actor || actor.isNpc) return { ...m, turnDeadline: null };
  return { ...m, turnDeadline: Date.now() + allowMs + SHOT_CLOCK_MS[m.game] };
}

// ── Start ────────────────────────────────────────────────────────────────────

export function createMatch(session: Session, game: MatchGame): Match {
  const humans: MatchPlayer[] = session.players
    .filter((p) => !p.isNpc)
    .slice(0, MAX_PLAYERS[game])
    .map((p) => ({ id: p.id, name: p.name, color: p.color, isNpc: false }));
  const hostId = humans[0].id;
  const base = { hostId, seq: 0, over: false, startedAt: Date.now(), turnDeadline: null };

  if (game === 'pool') {
    const players = [...humans];
    if (players.length === 1) {
      // Solo at the table: an NPC regular racks up against you
      const name = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)];
      players.push({ id: `npc:${name}`, name, color: '#b44bff', isNpc: true });
    }
    return stampTurn({ ...base, game, players, state: newGame(Math.floor(Math.random() * 1e9), 0) }, 4_000);
  }

  const state: BowlingGameState = {
    currentFrame: 0,
    currentThrow: 1,
    activePlayerId: humans[0].id,
    pinState: Array(10).fill(true),
    throwHistory: Object.fromEntries(humans.map((p) => [p.id, Array.from({ length: 10 }, () => [] as number[])])),
  };
  return stampTurn({ ...base, game, players: humans, state }, 4_000);
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
  const afk = { ...m.afk, [m.state.activePlayerId]: 0 };
  return stampTurn({ ...m, state, afk, seq: m.seq + 1, over: isGameComplete(state, ids) }, REPLAY_ALLOW_MS.bowling);
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
  const afk = { ...m.afk, [m.players[s.turn].id]: 0 };
  return stampTurn({ ...m, state, afk, seq: m.seq + 1, over: state.winner !== null }, REPLAY_ALLOW_MS.pool);
}

// ── Shot clock ran out ───────────────────────────────────────────────────────

/**
 * The current actor let the clock run out. Bowling: the throw counts as zero
 * pins. Pool: a foul — ball in hand to the opponent. Returns dropId instead
 * when this is their MAX_TIMEOUTS-th in a row (caller removes them).
 */
export function timeoutTurn(m: Match): { match: Match; dropId: string | null } {
  const actor = activeActor(m);
  const strikes = (m.afk?.[actor] ?? 0) + 1;
  if (strikes >= MAX_TIMEOUTS) return { match: m, dropId: actor };
  const afk = { ...m.afk, [actor]: strikes };

  if (m.game === 'bowling') {
    const ids = m.players.map((p) => p.id);
    const state = nextTurn(m.state, Array(10).fill(false), ids);
    return { match: stampTurn({ ...m, state, afk, seq: m.seq + 1, over: isGameComplete(state, ids) }, 1_500), dropId: null };
  }
  const state = {
    ...m.state,
    turn: m.state.turn === 0 ? 1 : 0,
    ballInHand: true,
    lastCall: { kind: 'foul', reason: 'timeout' } as const,
  };
  return { match: stampTurn({ ...m, state, afk, seq: m.seq + 1 }, 1_500), dropId: null };
}

// ── Players leaving mid-match ────────────────────────────────────────────────

/**
 * Remove a player from the match. `advanceSeq` is for shot-clock drops: the
 * timeout route has already claimed the current seq, so the match must move
 * past it or the next player's shot would be refused.
 */
export function dropPlayer(m0: Match, playerId: string, advanceSeq = false): Match | null {
  const idx = m0.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || m0.over) return null;
  const m = advanceSeq ? { ...m0, seq: m0.seq + 1 } : m0;

  if (m.game === 'pool') {
    // Walking away from the table concedes the rack
    const winner = idx === 0 ? 1 : 0;
    return { ...m, over: true, turnDeadline: null, state: { ...m.state, winner, lastCall: { kind: 'win', reason: 'eight' } } };
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
  const next = { ...m, players, hostId, state, over };
  // The lane changed hands → fresh clock; otherwise the current bowler keeps theirs
  return state.activePlayerId !== m.state.activePlayerId || over ? stampTurn(next, 1_500) : next;
}

// ── Redis ────────────────────────────────────────────────────────────────────

/**
 * Claim the right to change the match at shot `seq`. Exactly one caller wins,
 * so a shot landing as the clock runs out (or two phones reporting the same
 * timeout) can't both apply.
 */
const claimKey = (id: string, m: Match, seq: number) => `qt:match:claim:${id}:${m.startedAt}:${seq}`; // startedAt: a rematch restarts seq at 0
export async function claimSeq(id: string, m: Match, seq: number): Promise<boolean> {
  return (await redis.set(claimKey(id, m, seq), 1, { nx: true, ex: 120 })) === 'OK';
}
/** Give a claim back when the change it guarded failed to save, so a retry can land. */
export async function releaseSeq(id: string, m: Match, seq: number): Promise<void> {
  try { await redis.del(claimKey(id, m, seq)); } catch { /* expires on its own */ }
}

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
