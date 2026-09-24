// Aim guide geometry — pure. Casts the cue ball along the aim and reports the
// first thing it meets, like the guide lines in mobile pool games.

import { NUM_BALLS } from '@/lib/pool/pool-constants';
import { BALL_RADIUS as R, TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L, type PoolTable } from '@/lib/pool/pool-sim-core';

type V = [number, number];

export interface Guide {
  end: V;              // where the cue ball's centre stops (ghost ball or cushion contact)
  target: number;      // ball it would hit, −1 = none
  objDir: V | null;    // object ball's travel direction after contact
  cueDir: V | null;    // cue ball's deflection (tangent line) after contact
  cut: number;         // cut angle, radians (0 = full ball)
  bounce: V | null;    // reflected direction if it meets a cushion first
  cueSpeed: number;    // cue ball's rolling speed after contact, as a fraction of its incoming speed
}

/**
 * @param spin tip position: x = side (−1 left … +1 right english), y = −1 draw … +1 follow
 */
export function computeGuide(table: PoolTable, angle: number, spin: { x: number; y: number } = { x: 0, y: 0 }): Guide {
  const c = table.pos[0];
  const d: V = [Math.sin(angle), Math.cos(angle)];
  let tBest = Infinity, target = -1;
  for (let i = 1; i < NUM_BALLS; i++) {
    if (!table.active[i]) continue;
    const [px, pz] = table.pos[i];
    const ox = c[0] - px, oz = c[1] - pz;
    const b = ox * d[0] + oz * d[1];
    const cc = ox * ox + oz * oz - 4 * R * R;
    const disc = b * b - cc;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 1e-4 && t < tBest) { tBest = t; target = i; }
  }
  // Cushion (inner bounds the ball centre can reach)
  const bx = W - R, bz = L - R;
  const tx = d[0] > 0 ? (bx - c[0]) / d[0] : d[0] < 0 ? (-bx - c[0]) / d[0] : Infinity;
  const tz = d[1] > 0 ? (bz - c[1]) / d[1] : d[1] < 0 ? (-bz - c[1]) / d[1] : Infinity;
  const tWall = Math.max(0, Math.min(tx, tz));

  if (target >= 0 && tBest <= tWall) {
    const end: V = [c[0] + d[0] * tBest, c[1] + d[1] * tBest];
    const p = table.pos[target];
    const n: V = [(p[0] - end[0]) / (2 * R), (p[1] - end[1]) / (2 * R)];
    const cosCut = Math.max(-1, Math.min(1, n[0] * d[0] + n[1] * d[1]));
    // Right after contact the cue ball keeps only the tangent part of its velocity
    // (vt) but all of its spin (u, along the original line). Cloth friction then
    // settles it into a roll at (5·vt + 2·u)/7 — that's its real path. Follow/draw
    // left over at contact fades toward natural roll the further the ball travels.
    const vt: V = [d[0] - n[0] * cosCut, d[1] - n[1] * cosCut];
    const k0 = 1.25 * spin.y;
    const k = 1 + (k0 - 1) * Math.exp(-tBest / 0.7);
    const out: V = [(5 * vt[0] + 2 * k * d[0]) / 7, (5 * vt[1] + 2 * k * d[1]) / 7];
    const ol = Math.hypot(out[0], out[1]);
    return {
      end, target, objDir: n, cut: Math.acos(cosCut), bounce: null,
      cueDir: ol > 0.04 ? [out[0] / ol, out[1] / ol] : null, cueSpeed: ol,
    };
  }
  const end: V = [c[0] + d[0] * tWall, c[1] + d[1] * tWall];
  let bounce: V = tx < tz ? [-d[0], d[1]] : [d[0], -d[1]];
  if (spin.x) {
    // english kicks the rebound along the cushion (right english → shooter's right)
    const n: V = tx < tz ? [-Math.sign(d[0]), 0] : [0, -Math.sign(d[1])];
    const side: V = [n[1], -n[0]];
    const kick = spin.x * 0.5;
    const b: V = [bounce[0] + side[0] * kick, bounce[1] + side[1] * kick];
    const bl = Math.hypot(b[0], b[1]);
    bounce = [b[0] / bl, b[1] / bl];
  }
  return { end, target: -1, objDir: null, cueDir: null, cueSpeed: 0, cut: 0, bounce };
}
