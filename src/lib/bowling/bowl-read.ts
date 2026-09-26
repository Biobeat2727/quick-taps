// Reading the lane: lane wear over a game, and where a first ball hit the pocket.
// Pure and isomorphic. Every phone derives wear from the shared game state, so
// all players in a match bowl on the same lane.
//
// Thresholds come from scripts/bowl-calibrate.ts-style sweeps (ball centre at
// the pin deck): 4.5–11 cm off centre strikes ~70%; closer (HIGH) and crossed
// over (BROOKLYN) almost never strike; thinner (LIGHT) ~15%.

import type { BowlingGameState } from '@/types/bowling';

const THROWS_TO_DRY = 19; // ≈ one full game per bowler

/** 0 (fresh oil) → 0.85: the backend dries as the game goes on, so the ball hooks earlier and harder. */
export function laneWear(state: BowlingGameState, playerCount: number): number {
  let throws = 0;
  for (const frames of Object.values(state.throwHistory)) for (const f of frames) throws += f.length;
  return Math.min(0.85, throws / (Math.max(1, playerCount) * THROWS_TO_DRY));
}

export type LaneCondition = 'fresh' | 'drying' | 'dry';
export function laneCondition(wear: number): LaneCondition {
  return wear < 0.3 ? 'fresh' : wear < 0.6 ? 'drying' : 'dry';
}

export type PocketRead = 'POCKET' | 'HIGH' | 'LIGHT' | 'WIDE' | 'BROOKLYN';

/** Where a ball met the pins (from the sim's `entry`); null if it touched nothing. */
export function pocketRead(entry: { x: number; angle: number } | null | undefined): { read: PocketRead; angleDeg: number } | null {
  if (!entry) return null;
  const ax = Math.abs(entry.x);
  const angleDeg = entry.angle * (180 / Math.PI);
  let read: PocketRead;
  if (angleDeg < -0.5) read = 'BROOKLYN';        // hooked across the head pin, drifting away
  else if (ax < 0.045) read = 'HIGH';
  else if (ax <= 0.11) read = 'POCKET';
  else if (ax <= 0.2) read = 'LIGHT';
  else read = 'WIDE';
  return { read, angleDeg };
}
