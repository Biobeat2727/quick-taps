// Isomorphic 2D pool physics — no 'use client', no Node APIs, no Rapier.
// Runs on the shooter's phone for instant shots; deterministic for a given input.
//
// Model (per ball): position p, velocity v, and "roll velocity" u = ω × R — the
// ground speed the ball's spin would carry it at. While v ≠ u the ball slides and
// felt friction pulls them together (v loses, u gains at 5/2 the rate, solid
// sphere); once equal it rolls with light rolling resistance. Ball-ball contacts
// swap normal velocity but leave spin alone — which is exactly what produces
// stun, follow and draw with no special cases.

import { NUM_BALLS } from './pool-constants';

// Balls run ~12% over regulation (2.52" vs 2.25") so they read on a phone;
// pockets below are scaled to match, so the table plays the same.
export const BALL_RADIUS = 0.032;
const R = BALL_RADIUS;

// 7-ft bar box — what bars actually have. Playing surface 39" × 78".
// (The old 9-ft figures in pool-constants belong to the legacy Rapier pool.)
export const TABLE_HALF_WIDTH = 0.495;
export const TABLE_HALF_LENGTH = 0.99;
const W = TABLE_HALF_WIDTH, L = TABLE_HALF_LENGTH;

export const POOL_HZ = 60;
const SUB = 6;                        // physics substeps per recorded frame (360 Hz; a 9 m/s ball moves < R per step)
const DT = 1 / (POOL_HZ * SUB);
const MAX_FRAMES = 60 * 14;           // 14 s cap

const G = 9.81;
const MU_SLIDE = 0.2;                 // ball–cloth sliding friction
const ROLL_DECEL = 0.16;              // m/s² rolling resistance (bar cloth runs a touch slow)
const E_BALL = 0.95;                  // ball–ball restitution
const E_RAIL = 0.78;                  // cushion restitution
const RAIL_TANGENT_KEEP = 0.96;
const SIDE_DECAY = 1.2;               // m/s² — side spin bleeding off on the cloth
const RAIL_GRIP = 0.24;               // how much english a cushion can convert (× normal impulse)
const STOP_SPEED = 0.01;              // below this a rolling ball is called stopped — trims the dead crawl

// ── Table geometry ─────────────────────────────────────────────────────────
// Cushion noses are line segments; pocket openings are gaps between them with
// angled jaws. A ball whose centre passes beyond the cushion line can only have
// got there through an opening, so that is the capture test.

type Seg = [number, number, number, number]; // x0,z0,x1,z1

export const CORNER_MOUTH = 0.092;           // cushion stops this far from the corner along each rail
export const SIDE_MOUTH = 0.076;             // half-opening of side pockets
export const JAW = 0.045;
const RAIL_BAND = CORNER_MOUTH + JAW + 0.03; // balls further inside than this can't touch a cushion or jaw

function buildCushions(): Seg[] {
  const s: Seg[] = [];
  const cm = CORNER_MOUTH, sm = SIDE_MOUTH;
  for (const sx of [-1, 1]) {
    const x = sx * W;
    // long rails, split by the side pocket
    s.push([x, -L + cm, x, -sm], [x, sm, x, L - cm]);
    // side pocket jaws, flaring outward
    s.push([x, sm, x + sx * JAW, sm + JAW * 0.35], [x, -sm, x + sx * JAW, -sm - JAW * 0.35]);
  }
  for (const sz of [-1, 1]) {
    const z = sz * L;
    s.push([-W + cm, z, W - cm, z]);
  }
  // corner jaws, angled into the pocket
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const j = JAW / Math.SQRT2;
    const ax = sx * W, az = sz * (L - cm);         // knuckle on the long rail
    const bx = sx * (W - cm), bz = sz * L;         // knuckle on the end rail
    s.push([ax, az, ax + sx * j, az + sz * j], [bx, bz, bx + sx * j, bz + sz * j]);
  }
  return s;
}
export const CUSHIONS: readonly Seg[] = buildCushions();

/** Pocket centres (drawn), slightly outside the playing surface. */
export const POCKETS: readonly [number, number][] = [
  [-W - 0.012, L + 0.012], [W + 0.012, L + 0.012],
  [-W - 0.03, 0], [W + 0.03, 0],
  [-W - 0.012, -L - 0.012], [W + 0.012, -L - 0.012],
];

// ── Rack ───────────────────────────────────────────────────────────────────

export const HEAD_SPOT: [number, number] = [0, -L / 2];
export const FOOT_SPOT: [number, number] = [0, L / 2];

/** Standard 8-ball rack: 1 on the apex, 8 in the centre, a solid and a stripe in the back corners. */
export function rackPositions(seed: number): [number, number][] {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gap = 0.0004; // hair gap so the rack isn't pre-compressed
  const dz = (2 * R + gap) * Math.sqrt(3) / 2;
  const slots: [number, number][] = [];
  for (let row = 0; row < 5; row++)
    for (let k = 0; k <= row; k++)
      slots.push([(k - row / 2) * (2 * R + gap), FOOT_SPOT[1] + row * dz]);
  // slot 0 = apex, slot 4 = centre of row 3, slots 10 & 14 = back corners
  const rest = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((n) => n !== 7 && n !== 15);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const [cornerA, cornerB] = rnd() < 0.5 ? [7, 15] : [15, 7];
  const order: number[] = new Array(15);
  order[0] = 1; order[4] = 8; order[10] = cornerA; order[14] = cornerB;
  let r = 0;
  for (let i = 0; i < 15; i++) if (order[i] === undefined) order[i] = rest[r++];
  const pos: [number, number][] = new Array(NUM_BALLS);
  pos[0] = HEAD_SPOT;
  order.forEach((ball, i) => { pos[ball] = slots[i]; });
  return pos;
}

// ── Shot ───────────────────────────────────────────────────────────────────

export interface PoolTable {
  pos: [number, number][];  // [16] x,z
  active: boolean[];        // [16] on the table
}

export interface PoolShot {
  angle: number;  // radians; 0 = toward +Z, +π/2 = toward +X
  speed: number;  // cue-ball speed off the tip, m/s (≈0.3 soft … 9 break)
  spin: number;   // −1 draw … 0 stun … +1 follow
  side?: number;  // −1 left english … +1 right english
}

export type PoolEvent =
  | { f: number; type: 'ball'; a: number; b: number; speed: number }
  | { f: number; type: 'rail'; a: number; speed: number }
  | { f: number; type: 'pocket'; a: number; pocket: number };

export interface PoolSimResult {
  numFrames: number;
  frames: Float32Array;       // numFrames × 16 × 2 (x, z); pocketed balls hold their last position
  pocketedAt: number[];       // [16] frame, −1 = not pocketed
  pocketOf: number[];         // [16] pocket index, −1
  firstHit: number;           // first object ball the cue ball touched, −1 = none
  railAfterContact: boolean;  // any ball hit a cushion after first contact
  final: PoolTable;
  events: PoolEvent[];
}

export function simulatePoolShot(table: PoolTable, shot: PoolShot): PoolSimResult {
  const n = NUM_BALLS;
  const px = new Float64Array(n), pz = new Float64Array(n);
  const vx = new Float64Array(n), vz = new Float64Array(n);
  const ux = new Float64Array(n), uz = new Float64Array(n);
  // Side spin as surface speed, w = R·ω_y. Facing up the table (+Z), the shooter's
  // right is −X; striking there spins the ball with ω_y > 0, so right english → w > 0.
  const ws = new Float64Array(n);
  const on = table.active.slice();
  for (let i = 0; i < n; i++) { px[i] = table.pos[i][0]; pz[i] = table.pos[i][1]; }

  // Cue strike. Tip height h (fraction of R) sets spin: u = 2.5·v·h/R;
  // natural roll (u = v) at h = 0.4R, so spin ±1 maps to h = ±0.5R.
  const sp = Math.max(0.05, Math.min(10, shot.speed));
  const dx = Math.sin(shot.angle), dz = Math.cos(shot.angle);
  vx[0] = dx * sp; vz[0] = dz * sp;
  const k = 1.25 * Math.max(-1, Math.min(1, shot.spin));
  ux[0] = vx[0] * k; uz[0] = vz[0] * k;
  ws[0] = 1.25 * sp * Math.max(-1, Math.min(1, shot.side ?? 0));

  const frames = new Float32Array(MAX_FRAMES * n * 2);
  const pocketedAt = new Array(n).fill(-1);
  const pocketOf = new Array(n).fill(-1);
  const events: PoolEvent[] = [];
  let firstHit = -1;
  let railAfterContact = false;
  let numFrames = 0;
  const lastRail = new Int32Array(n).fill(-99);

  const slideDv = MU_SLIDE * G * DT;
  const slideDu = 2.5 * slideDv;
  const rollDv = ROLL_DECEL * DT;

  for (let f = 0; f < MAX_FRAMES; f++) {
    for (let s = 0; s < SUB; s++) {
      // ── Integrate + cloth friction ──
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        const rx = vx[i] - ux[i], rz = vz[i] - uz[i];
        const rel = Math.sqrt(rx * rx + rz * rz);
        if (rel > slideDu + slideDv) {
          const nx = rx / rel, nz = rz / rel;
          vx[i] -= nx * slideDv; vz[i] -= nz * slideDv;
          ux[i] += nx * slideDu; uz[i] += nz * slideDu;
        } else {
          // rolling — spin locked to velocity
          const sp2 = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]);
          if (sp2 <= rollDv || sp2 < STOP_SPEED) { vx[i] = vz[i] = ux[i] = uz[i] = 0; }
          else { const m = (sp2 - rollDv) / sp2; vx[i] *= m; vz[i] *= m; ux[i] = vx[i]; uz[i] = vz[i]; }
        }
        px[i] += vx[i] * DT; pz[i] += vz[i] * DT;
        if (ws[i] !== 0) {
          const dec = SIDE_DECAY * DT;
          ws[i] = Math.abs(ws[i]) <= dec || (vx[i] === 0 && vz[i] === 0) ? 0 : ws[i] - Math.sign(ws[i]) * dec;
        }
      }

      // ── Ball–ball ── (a pair where neither ball is moving can't newly collide)
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        const iStill = vx[i] === 0 && vz[i] === 0;
        for (let j = i + 1; j < n; j++) {
          if (!on[j] || (iStill && vx[j] === 0 && vz[j] === 0)) continue;
          const ddx = px[j] - px[i], ddz = pz[j] - pz[i];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = ddx / d, nz = ddz / d;
          const push = (2 * R - d) / 2;
          px[i] -= nx * push; pz[i] -= nz * push; px[j] += nx * push; pz[j] += nz * push;
          const vn = (vx[i] - vx[j]) * nx + (vz[i] - vz[j]) * nz;
          if (vn <= 0) continue;
          const jmp = (1 + E_BALL) * vn / 2;
          vx[i] -= jmp * nx; vz[i] -= jmp * nz; vx[j] += jmp * nx; vz[j] += jmp * nz;
          if (firstHit < 0 && (i === 0 || j === 0)) firstHit = i === 0 ? j : i;
          if (vn > 0.05) events.push({ f, type: 'ball', a: i, b: j, speed: vn });
        }
      }

      // ── Cushions ── (only for moving balls near the rails)
      for (let i = 0; i < n; i++) {
        if (!on[i] || (vx[i] === 0 && vz[i] === 0)) continue;
        if (Math.abs(px[i]) < W - RAIL_BAND && Math.abs(pz[i]) < L - RAIL_BAND) continue;
        for (const [x0, z0, x1, z1] of CUSHIONS) {
          const ex = x1 - x0, ez = z1 - z0;
          const len2 = ex * ex + ez * ez;
          let t = ((px[i] - x0) * ex + (pz[i] - z0) * ez) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = x0 + ex * t, cz = z0 + ez * t;
          const ox = px[i] - cx, oz = pz[i] - cz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= R * R || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = ox / d, nz = oz / d;
          px[i] = cx + nx * R; pz[i] = cz + nz * R;
          const vn = vx[i] * nx + vz[i] * nz;
          if (vn >= 0) continue;
          const tx = vx[i] - vn * nx, tz = vz[i] - vn * nz;
          vx[i] = tx * RAIL_TANGENT_KEEP - vn * E_RAIL * nx;
          vz[i] = tz * RAIL_TANGENT_KEEP - vn * E_RAIL * nz;
          // English: the spinning surface grips the cushion and kicks the ball sideways
          // (right english comes off to the right). Limited by how hard it hit.
          if (ws[i] !== 0) {
            const kick = Math.min(Math.abs(ws[i]) * 0.6, RAIL_GRIP * -vn * (1 + E_RAIL)) * Math.sign(ws[i]);
            vx[i] += kick * nz; vz[i] += kick * -nx;
            ws[i] *= 0.45;
          }
          // cushion kills the spin component into the rail; ball re-slides off it
          const un = ux[i] * nx + uz[i] * nz;
          ux[i] -= un * nx; uz[i] -= un * nz;
          if (firstHit >= 0) railAfterContact = true;
          if (-vn > 0.08 && f - lastRail[i] > 3) { events.push({ f, type: 'rail', a: i, speed: -vn }); lastRail[i] = f; }
        }
      }

      // ── Pockets ── (only reachable through an opening)
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        if (Math.abs(px[i]) > W + R * 0.45 || Math.abs(pz[i]) > L + R * 0.45) {
          let best = 0, bd = Infinity;
          POCKETS.forEach(([qx, qz], q) => { const dd = (px[i] - qx) ** 2 + (pz[i] - qz) ** 2; if (dd < bd) { bd = dd; best = q; } });
          on[i] = false;
          pocketedAt[i] = f; pocketOf[i] = best;
          vx[i] = vz[i] = ux[i] = uz[i] = 0;
          events.push({ f, type: 'pocket', a: i, pocket: best });
        }
      }
    }

    const o = f * n * 2;
    for (let i = 0; i < n; i++) { frames[o + i * 2] = px[i]; frames[o + i * 2 + 1] = pz[i]; }
    numFrames = f + 1;

    let moving = false;
    for (let i = 0; i < n && !moving; i++) if (on[i] && (vx[i] !== 0 || vz[i] !== 0)) moving = true;
    if (!moving) break;
  }

  const pos: [number, number][] = [];
  for (let i = 0; i < n; i++) pos.push([px[i], pz[i]]);
  return {
    numFrames,
    frames: frames.slice(0, numFrames * n * 2),
    pocketedAt, pocketOf, firstHit, railAfterContact,
    final: { pos, active: on },
    events,
  };
}
