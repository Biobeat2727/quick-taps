// Turn-based matches (bowling, pool). The shooter's phone simulates the shot for
// an instant result, then uploads it; the server checks the turn, applies the
// game rules itself, stores the replay, and broadcasts the new state.

import type { BowlingGameState } from '@/types/bowling';
import type { PoolState } from '@/lib/pool/pool-rules';
import type { PoolEvent, PoolShot, PoolTable } from '@/lib/pool/pool-sim-core';

export type MatchGame = 'bowling' | 'pool';

export interface MatchPlayer {
  id: string;
  name: string;
  color: string;
  isNpc: boolean;
}

interface MatchBase {
  players: MatchPlayer[];  // turn order
  hostId: string;          // first human — also drives NPC turns
  seq: number;             // number of shots applied so far
  over: boolean;
  startedAt: number;
  /** Server time (ms) the current human turn times out; null on NPC turns / game over. */
  turnDeadline: number | null;
  /** Consecutive shot-clock timeouts per player (reset when they shoot). */
  afk?: Record<string, number>;
  /** Transport only: server clock when this was sent, so phones can correct for clock skew. */
  serverNow?: number;
  /** Client only: this copy came from a resync after the server refused our change — apply it even at the same seq. */
  resync?: boolean;
}

export interface BowlingMatch extends MatchBase { game: 'bowling'; state: BowlingGameState }
export interface PoolMatch extends MatchBase { game: 'pool'; state: PoolState }
export type Match = BowlingMatch | PoolMatch;

// ── Shot payloads (client → server) ──────────────────────────────────────────

export interface BowlRecording {
  numFrames: number;
  ball: string;        // base64 Float32Array, numFrames × 7
  pins: string;        // base64 Float32Array, numFrames × 70
  impactFrame: number;
  gutterFrame: number;
  knocked: boolean[];  // [10] — spectators need it for the callout
  speed: number;       // m/s
  spin: number;        // world spin, for the HOOK ←/→ readout
}

export interface BowlShotPayload {
  knocked: boolean[];  // [10] newly knocked this throw
  speed: number;       // m/s, for the spectators' readout
  spin: number;
  rec: BowlRecording;
}

export interface PoolRecording {
  numFrames: number;
  frames: string;      // base64 Float32Array, numFrames × 16 × 2
  pocketedAt: number[];
  pocketOf: number[];
  events: PoolEvent[];
}

export interface PoolShotPayload {
  cue: [number, number] | null;  // ball-in-hand placement, if any
  shot: PoolShot;
  firstHit: number;
  railAfterContact: boolean;
  final: PoolTable;
  rec: PoolRecording;
}

// ── Ably messages on qt:session:{id} ─────────────────────────────────────────

export interface MatchStartedMessage { name: 'match:started'; data: { game: MatchGame } }

/** A shot was applied. `seq` is the index of this shot (state is after it). */
export interface MatchShotMessage {
  name: 'match:shot';
  data: { seq: number; actorId: string; match: Match };
}

/** Out-of-band change (a player left, forfeit…). */
export interface MatchUpdateMessage {
  name: 'match:update';
  data: { match: Match; reason: string };
}
