// Offline bowling calibration: npx tsx scripts/bowl-calibrate.ts [throwsPerBowler]
// Simulated bowlers throw first balls at a full rack; reports strike %, average
// pins, how many different leaves they see, and how often two back-to-back
// throws produce the exact same leave (the "rigid / repeatable" problem).

import RAPIER from '@dimforge/rapier3d-compat';
import { runBowlSim } from '../src/lib/bowling/bowl-sim-core';
import { releaseThrow } from '../src/lib/bowling/bowl-release';

const N = Number(process.argv[2] ?? 60);
const FULL = Array(10).fill(true);

interface Bowler {
  name: string;
  /** What the bowler intends, before release error. wear = lane wear 0..1 */
  intent: (i: number) => { startX: number; direction: number; speed: number; spin: number; wear: number };
}

// Human thumbs vary a little on their own even when they "repeat" a throw
const jitter = (s: number) => (Math.random() - 0.5) * 2 * s;

function leaveKey(k: boolean[]) { return k.map((d) => (d ? '.' : 'o')).join(''); }

async function main() {
  await RAPIER.init();

  // Find "the spot": the straight max-power board that strikes on a fresh lane
  // with no release error — what a player discovers and then spams.
  let spot = 0, bestScore = -1;
  for (let b = -16; b <= 16; b++) {
    const x = (b * 1.06) / 39;
    const r = runBowlSim(RAPIER, { startX: x, direction: 0, speed: 9, spin: 0, pinState: FULL, laneWear: 0, variance: 0 });
    const n = r.knockedPins.filter(Boolean).length;
    if (n > bestScore || (n === bestScore && Math.abs(x - 0.06) < Math.abs(spot - 0.06))) { bestScore = n; spot = x; }
  }
  console.log(`spot: startX ${spot.toFixed(3)} (${bestScore} pins, no variance)`);

  const bowlers: Bowler[] = [
    { name: 'masher (spot, max power, straight)', intent: () => ({ startX: spot, direction: 0, speed: 9.99, spin: 0, wear: 0 }) },
    { name: 'masher late game (wear 0.8)', intent: () => ({ startX: spot, direction: 0, speed: 9.99, spin: 0, wear: 0.8 }) },
    { name: 'controlled straight (spot, 7.6 m/s)', intent: () => ({ startX: spot, direction: 0, speed: 7.6 + jitter(0.3), spin: 0, wear: 0 }) },
    { name: 'good hook line (x .27, spin −.55)', intent: () => ({ startX: 0.27, direction: 0, speed: 7.8 + jitter(0.3), spin: -0.55 + jitter(0.05), wear: 0 }) },
    { name: 'same line late game (wear 0.8)', intent: () => ({ startX: 0.27, direction: 0, speed: 7.8 + jitter(0.3), spin: -0.55 + jitter(0.05), wear: 0.8 }) },
    { name: 'line adjusted for wear (x .35, d .006)', intent: () => ({ startX: 0.35, direction: 0.006, speed: 7.8 + jitter(0.3), spin: -0.55 + jitter(0.05), wear: 0.8 }) },
    { name: 'good hook at max power', intent: () => ({ startX: 0.27, direction: 0, speed: 9.99, spin: -0.55 + jitter(0.05), wear: 0 }) },
    { name: 'random casual (any board, any speed)', intent: () => ({ startX: jitter(0.3), direction: jitter(0.01), speed: 6.5 + Math.random() * 3.4, spin: Math.random() < 0.3 ? jitter(0.8) : 0, wear: Math.random() }) },
  ];

  for (const b of bowlers) {
    let strikes = 0, pins = 0, repeats = 0, gutters = 0;
    const leaves = new Set<string>();
    let prev = '';
    for (let i = 0; i < N; i++) {
      const it = b.intent(i);
      const t = releaseThrow({ startX: it.startX, direction: it.direction, speed: it.speed, spin: it.spin }, Math.random);
      const r = runBowlSim(RAPIER, { ...t, pinState: FULL, laneWear: it.wear });
      const n = r.knockedPins.filter(Boolean).length;
      const key = leaveKey(r.knockedPins);
      if (n === 10) strikes++;
      if (r.gutterFrame >= 0 && n === 0) gutters++;
      pins += n;
      leaves.add(key);
      if (key === prev) repeats++;
      prev = key;
    }
    console.log(
      `${b.name.padEnd(40)} strike ${(100 * strikes / N).toFixed(0).padStart(3)}%  avg ${(pins / N).toFixed(1)}  ` +
      `leaves ${String(leaves.size).padStart(2)}  same-as-last ${(100 * repeats / (N - 1)).toFixed(0).padStart(3)}%  gutter ${(100 * gutters / N).toFixed(0)}%`,
    );
  }
}
main();
