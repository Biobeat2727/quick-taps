// 8-ball rules on top of pool-sim-core. Pure + isomorphic.
//
// Bar rules, kept friendly: ball-in-hand anywhere after any foul; table is open
// after the break; groups are claimed by the first ball legally pocketed on an
// open table; 8 on the break is re-spotted. Fouls: scratch, hitting nothing,
// or hitting the wrong ball first. (No "rail after contact" rule — most bar
// players don't know it, and it would read as a mystery foul.)

import { NUM_BALLS } from './pool-constants';
import { BALL_RADIUS as R, TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L, rackPositions, HEAD_SPOT, FOOT_SPOT, type PoolTable, type PoolSimResult } from './pool-sim-core';

export type Group = 'solid' | 'stripe';

export interface PoolState {
  table: PoolTable;
  turn: number;                       // index into players
  groups: [Group, Group] | null;      // per player, once claimed
  ballInHand: boolean;
  isBreak: boolean;
  shotCount: number;
  winner: number | null;
  lastCall: PoolCall | null;          // what just happened, for the HUD
}

export type PoolCall =
  | { kind: 'foul'; reason: 'scratch' | 'no-hit' | 'wrong-ball' | 'timeout' }
  | { kind: 'pot'; balls: number[] }
  | { kind: 'miss' }
  | { kind: 'claim'; group: Group }
  | { kind: 'win'; reason: 'eight' }
  | { kind: 'loss'; reason: 'early-eight' | 'eight-scratch' | 'eight-foul' };

export const groupOf = (b: number): Group | null => (b >= 1 && b <= 7 ? 'solid' : b >= 9 && b <= 15 ? 'stripe' : null);

export function newGame(seed: number, firstTurn = 0): PoolState {
  return {
    table: { pos: rackPositions(seed), active: Array(NUM_BALLS).fill(true) },
    turn: firstTurn, groups: null, ballInHand: true, isBreak: true, shotCount: 0, winner: null, lastCall: null,
  };
}

/** Balls the shooter may legally hit first. */
export function legalTargets(s: PoolState): number[] {
  const act = s.table.active;
  const objs = [...Array(15)].map((_, i) => i + 1).filter((b) => act[b]);
  if (!s.groups) return objs.filter((b) => b !== 8 || objs.length === 1);
  const mine = s.groups[s.turn];
  const own = objs.filter((b) => groupOf(b) === mine);
  return own.length ? own : act[8] ? [8] : [];
}

export function ballsLeft(s: PoolState, player: number): number {
  if (!s.groups) return 7;
  const g = s.groups[player];
  return [...Array(15)].map((_, i) => i + 1).filter((b) => groupOf(b) === g && s.table.active[b]).length;
}

/** Is `[x, z]` a legal cue-ball placement (on the cloth, not touching a ball)? */
export function canPlaceCue(s: PoolState, x: number, z: number): boolean {
  if (Math.abs(x) > W - R || Math.abs(z) > L - R) return false;
  for (let i = 1; i < NUM_BALLS; i++) {
    if (!s.table.active[i]) continue;
    const [bx, bz] = s.table.pos[i];
    if ((bx - x) ** 2 + (bz - z) ** 2 < (2 * R + 0.001) ** 2) return false;
  }
  return true;
}

/** Nearest free spot to `[x, z]` along the long axis — for re-spotting the cue or 8. */
function freeSpot(table: PoolTable, [x, z]: [number, number], skip: number): [number, number] {
  const free = (px: number, pz: number) =>
    table.pos.every(([bx, bz], i) => i === skip || !table.active[i] || (bx - px) ** 2 + (bz - pz) ** 2 >= (2 * R + 0.002) ** 2);
  for (let k = 0; k < 60; k++) {
    for (const dir of [1, -1]) {
      const pz = z + dir * k * R;
      if (Math.abs(pz) < L - R && free(x, pz)) return [x, pz];
    }
  }
  return [x, z];
}

/** Apply a simulated shot to the game. */
export function applyShot(s: PoolState, sim: PoolSimResult): PoolState {
  const shooter = s.turn, other = 1 - s.turn;
  const potted = [...Array(15)].map((_, i) => i + 1).filter((b) => sim.pocketedAt[b] >= 0)
    .sort((a, b) => sim.pocketedAt[a] - sim.pocketedAt[b]);
  const scratch = sim.pocketedAt[0] >= 0;
  const legal = legalTargets(s);

  let foul: 'scratch' | 'no-hit' | 'wrong-ball' | null = null;
  if (scratch) foul = 'scratch';
  else if (sim.firstHit < 0) foul = 'no-hit';
  else if (!s.isBreak && !legal.includes(sim.firstHit)) foul = 'wrong-ball';

  const table: PoolTable = { pos: sim.final.pos.map((p) => [p[0], p[1]] as [number, number]), active: sim.final.active.slice() };
  const base = { ...s, table, isBreak: false, shotCount: s.shotCount + 1, ballInHand: false };

  // ── The 8 ──
  if (potted.includes(8)) {
    if (s.isBreak) {
      // 8 on the break: re-spot it, shooter carries on (or loses turn on a scratch)
      table.active[8] = true;
      table.pos[8] = freeSpot(table, FOOT_SPOT, 8);
    } else {
      const clearedBefore = !!s.groups && ballsLeft(s, shooter) === 0;
      if (clearedBefore && !foul) return { ...base, winner: shooter, lastCall: { kind: 'win', reason: 'eight' } };
      return {
        ...base, winner: other,
        lastCall: { kind: 'loss', reason: !clearedBefore ? 'early-eight' : scratch ? 'eight-scratch' : 'eight-foul' },
      };
    }
  }

  if (scratch) {
    table.active[0] = true;
    table.pos[0] = freeSpot(table, HEAD_SPOT, 0);
  }

  if (foul) return { ...base, turn: other, ballInHand: true, lastCall: { kind: 'foul', reason: foul } };

  const objPotted = potted.filter((b) => b !== 8);
  let groups = s.groups;
  let claimed: Group | null = null;
  if (!groups && !s.isBreak && objPotted.length) {
    claimed = groupOf(objPotted[0])!;
    const otherG: Group = claimed === 'solid' ? 'stripe' : 'solid';
    groups = shooter === 0 ? [claimed, otherG] : [otherG, claimed];
  }

  const keepsTurn = groups
    ? objPotted.some((b) => groupOf(b) === groups![shooter])
    : objPotted.length > 0; // open table / break: any ball keeps you at the table

  return {
    ...base, groups,
    turn: keepsTurn ? shooter : other,
    lastCall: claimed ? { kind: 'claim', group: claimed } : objPotted.length ? { kind: 'pot', balls: objPotted } : { kind: 'miss' },
  };
}
