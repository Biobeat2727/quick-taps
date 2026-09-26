// Offline bowling calibration: npx tsx scripts/bowl-calibrate.ts [throwsPerBowler]
// Simulated thumbs go through the real swipe mapping (mapFlick) and release
// variance, then throw first balls at a full rack. Reports strike %, average
// pins, how many different leaves they see, and how often two back-to-back
// throws leave exactly the same pins (the old "rigid / repeatable" problem).

import RAPIER from '@dimforge/rapier3d-compat';
import { runBowlSim } from '../src/lib/bowling/bowl-sim-core';
import { releaseThrow } from '../src/lib/bowling/bowl-release';
import { mapFlick } from '../src/components/game/bowling-v2/useSwipeThrow';

const N = Number(process.argv[2] ?? 100);
const FULL = Array(10).fill(true);
const MAX_AIM_X = 0.45;

const gauss = () => {
  const u = Math.max(1e-9, Math.random()), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** A thumb: where it lines up (world x), how hard it flicks, and how much it curves (screen rad, + = right). */
interface Thumb { name: string; x: () => number; screensPerSec: () => number; arc: () => number; chord: () => number }

const thumbs: Thumb[] = [
  { name: 'straight, centre, medium flick', x: () => 0, screensPerSec: () => 1.4 + gauss() * 0.3, arc: () => gauss() * 0.08, chord: () => gauss() * 0.03 },
  { name: 'masher (centre, hardest flick)', x: () => 0, screensPerSec: () => 4 + gauss() * 0.3, arc: () => gauss() * 0.1, chord: () => gauss() * 0.04 },
  { name: 'hooker (x .30, clear curve)', x: () => 0.3, screensPerSec: () => 1.6 + gauss() * 0.3, arc: () => 0.3 + gauss() * 0.06, chord: () => gauss() * 0.03 },
  { name: 'hooker, sloppy curve', x: () => 0.3, screensPerSec: () => 1.6 + gauss() * 0.3, arc: () => 0.3 + gauss() * 0.12, chord: () => gauss() * 0.05 },
  { name: 'hooker at max power', x: () => 0.3, screensPerSec: () => 4 + gauss() * 0.3, arc: () => 0.3 + gauss() * 0.06, chord: () => gauss() * 0.03 },
  { name: 'big curve (x .42, exaggerated)', x: () => 0.42, screensPerSec: () => 1.6 + gauss() * 0.3, arc: () => 0.75 + gauss() * 0.08, chord: () => gauss() * 0.03 },
  { name: 'random casual', x: () => (Math.random() - 0.5) * 0.7, screensPerSec: () => 0.8 + Math.random() * 3.4, arc: () => gauss() * 0.3, chord: () => gauss() * 0.08 },
];

async function main() {
  await RAPIER.init();
  for (const th of thumbs) {
    let strikes = 0, pins = 0, repeats = 0, gutters = 0;
    const leaves = new Set<string>();
    let prev = '';
    for (let i = 0; i < N; i++) {
      const m = mapFlick(th.chord(), th.arc(), th.screensPerSec());
      // Screen → world: the camera looks down +Z, so screen-right is −X
      const intent = { startX: Math.max(-MAX_AIM_X, Math.min(MAX_AIM_X, th.x())), direction: -m.direction, speed: m.speed, spin: -m.spin };
      const r = runBowlSim(RAPIER, { ...releaseThrow(intent), pinState: FULL });
      const n = r.knockedPins.filter(Boolean).length;
      const key = r.knockedPins.map((d) => (d ? '.' : 'o')).join('');
      if (n === 10) strikes++;
      if (r.gutterFrame >= 0 && n === 0) gutters++;
      pins += n;
      leaves.add(key);
      if (key === prev) repeats++;
      prev = key;
    }
    console.log(
      `${th.name.padEnd(34)} strike ${(100 * strikes / N).toFixed(0).padStart(3)}%  avg ${(pins / N).toFixed(1)}  ` +
      `leaves ${String(leaves.size).padStart(2)}  same-as-last ${(100 * repeats / (N - 1)).toFixed(0).padStart(3)}%  gutter ${(100 * gutters / N).toFixed(0)}%`,
    );
  }
}
main();
