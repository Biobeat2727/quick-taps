// Isomorphic marble-track builder — no 'use client', no DOM/Node APIs.
// A map is authored as a centerline (via Turtle) plus features positioned by
// arc length. buildTrack() sweeps a banked U-trough along that line; the same
// vertex data feeds the Rapier trimesh (server/lab sim) and the three.js mesh.

import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';

export interface ControlPoint {
  x: number; y: number; z: number;
  w: number;      // trough width
  wall: number;   // wall height
  gap: boolean;   // the segment arriving at this point is open air (a jump)
  roof: boolean;  // the segment arriving at this point has a glass roof (a tube)
  ts: number;     // turtle arc length at this point (features are authored in it)
}

/** Authoring helper: walk the course like a turtle, dropping by `grade` per unit. */
export class Turtle {
  x: number; y: number; z: number;
  h = 0;          // heading in the XZ plane; 0 = +Z, +π/2 = +X
  s = 0;          // approximate arc length so far (for positioning features)
  w = 5;
  wall = 1.6;
  roof = false;
  pts: ControlPoint[] = [];

  constructor(x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z;
    this.emit(false);
  }

  private emit(gap: boolean) {
    this.pts.push({ x: this.x, y: this.y, z: this.z, w: this.w, wall: this.wall, gap, roof: this.roof, ts: this.s });
  }

  private step(d: number, grade: number, gap: boolean) {
    this.x += Math.sin(this.h) * d;
    this.z += Math.cos(this.h) * d;
    this.y -= grade * d;
    this.s += Math.hypot(d, grade * d);
    this.emit(gap);
  }

  fwd(len: number, grade: number, opts: { gap?: boolean; step?: number } = {}) {
    const n = Math.max(1, Math.ceil(len / (opts.step ?? 4)));
    for (let i = 0; i < n; i++) this.step(len / n, grade, !!opts.gap);
    return this;
  }

  /** Arc of `deg` degrees (positive turns from +Z toward +X) at radius R. */
  turn(deg: number, R: number, grade: number) {
    const rad = (deg * Math.PI) / 180;
    const n = Math.max(2, Math.ceil((Math.abs(rad) * R) / 2.5));
    const dθ = rad / n;
    const chord = 2 * R * Math.sin(Math.abs(dθ) / 2);
    for (let i = 0; i < n; i++) {
      this.h += dθ / 2;
      this.step(chord, grade, false);
      this.h += dθ / 2;
    }
    return this;
  }

  /** Centre of a turn of radius R starting now (sign = turn direction). */
  turnCentre(R: number, sign: 1 | -1) {
    return new Vector3(this.x + sign * R * Math.cos(this.h), this.y, this.z - sign * R * Math.sin(this.h));
  }
}

// ── Features ────────────────────────────────────────────────────────────────

export interface Spinner { s: number; offset: number; arm: number; omega: number; phase: number }
/** pop: a big high-energy pop-bumper that flashes when hit. */
export interface Bumper { s: number; offset: number; r: number; pop?: boolean }
/** Boxing glove that punches out of a wall on a timer. side: −1 = −side wall, +1 = +side wall. */
export interface Puncher { s: number; side: -1 | 1; reach: number; period: number; phase: number }
export interface Zone { name: string; s: number; color: string }
/** Camera override while the followed marble is between from and to. */
export type CamZone =
  | { kind: 'orbit'; from: number; to: number; x: number; z: number; r: number } // circle outside a helix
  | { kind: 'fixed'; from: number; to: number; at: number; side: number; up: number; back?: number }; // broadcast cam beside/above the track

export interface MarbleMapDef {
  id: string;
  name: string;
  points: ControlPoint[];
  gateS: number;
  finishS: number;
  spinners: Spinner[];
  bumpers: Bumper[];
  punchers: Puncher[];
  zones: Zone[];
  pillars: { x: number; z: number; y0: number; y1: number; color: string }[];
  cams: CamZone[];
  groundY: number;
}

// ── Built track ─────────────────────────────────────────────────────────────

export interface Frame {
  p: Vector3;
  t: Vector3;     // tangent (forward)
  side: Vector3;  // banked lateral axis
  n: Vector3;     // banked floor normal
  w: number;
  wall: number;
  wallL: number;  // actual wall heights: the outside of a turn is built taller
  wallR: number;
  gap: boolean;   // the stretch ahead of this sample is open air
  roof: boolean;  // the stretch ahead of this sample is roofed
  s: number;
}

export interface BuiltTrack {
  def: MarbleMapDef;
  /** Features re-expressed in true spline arc length (use these, not def's). */
  gateS: number;
  finishS: number;
  spinners: Spinner[];
  bumpers: Bumper[];
  punchers: Puncher[];
  zones: Zone[];
  cams: CamZone[];
  ds: number;
  length: number;
  frames: Frame[];
  /** Trough geometry: floor triangles first, then walls (render groups). */
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  floorIndexCount: number;
  /** Neon lip polylines, one per continuous run per side, tagged with zone index. */
  rails: { pts: Vector3[]; zone: number }[];
  gapRanges: [number, number][];
}

const DS = 0.5;
const UP = new Vector3(0, 1, 0);
// Gentle banks, eased over ~12 units: a bank that rolls in faster than the
// track descends makes the inside/outside edge locally uphill and stalls slow marbles.
const DESIGN_V2_OVER_G = 7;   // v²/g used for auto-banking
const MAX_BANK = 0.42;        // rad
const OUTER_WALL_GAIN = 3.2;  // extra outside-wall height per radian of bank
const BANK_SMOOTH = 24;       // samples each side

function profile(w: number, HL: number, HR: number): [number, number][] {
  const a = w / 2;
  return [[-a, HL], [-a, 0.55], [-a + 0.18, 0.18], [-a + 0.6, 0], [a - 0.6, 0], [a - 0.18, 0.18], [a, 0.55], [a, HR]];
}
const FLOOR_SEGS = new Set([2, 3, 4]);

const cache = new Map<string, BuiltTrack>();

export function buildTrack(def: MarbleMapDef): BuiltTrack {
  const hit = cache.get(def.id);
  if (hit) return hit;

  const cps = def.points;
  const curve = new CatmullRomCurve3(cps.map((c) => new Vector3(c.x, c.y, c.z)), false, 'centripetal');

  // Dense parameter sampling → cumulative arc length
  const M = (cps.length - 1) * 24;
  const dense: Vector3[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= M; i++) {
    dense.push(curve.getPoint(i / M));
    if (i > 0) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
  }
  const length = cum[M];

  // Turtle arc length → spline arc length, piecewise linear through the CPs
  const remap = (ts: number) => {
    for (let i = 0; i < cps.length - 1; i++) {
      const a = cps[i].ts, b = cps[i + 1].ts;
      if (ts <= b || i === cps.length - 2) {
        const f = (ts - a) / Math.max(1e-9, b - a);
        return cum[i * 24] + (cum[(i + 1) * 24] - cum[i * 24]) * f;
      }
    }
    return ts;
  };
  const zones = def.zones.map((z) => ({ ...z, s: remap(z.s) }));

  // Uniform resample at DS
  const N = Math.floor(length / DS) + 1;
  const pos: Vector3[] = [];
  const cpIdx: number[] = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = i * DS;
    while (k < M - 1 && cum[k + 1] < s) k++;
    const f = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    pos.push(dense[k].clone().lerp(dense[k + 1], Math.min(1, f)));
    cpIdx.push(((k + f) / M) * (cps.length - 1));
  }

  // Tangents, lateral axes, signed horizontal curvature → auto bank
  const tan: Vector3[] = pos.map((_, i) => {
    const a = pos[Math.max(0, i - 1)], b = pos[Math.min(N - 1, i + 1)];
    return b.clone().sub(a).normalize();
  });
  const side0 = tan.map((t) => t.clone().cross(UP).normalize());
  const rawBank = tan.map((_, i) => {
    const a = tan[Math.max(0, i - 2)], b = tan[Math.min(N - 1, i + 2)];
    const span = (Math.min(N - 1, i + 2) - Math.max(0, i - 2)) * DS;
    const dT = b.clone().sub(a).divideScalar(span || 1);
    return Math.atan(dT.dot(side0[i]) * DESIGN_V2_OVER_G);
  });
  const bank = rawBank.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = i - BANK_SMOOTH; j <= i + BANK_SMOOTH; j++) if (j >= 0 && j < N) { sum += rawBank[j]; c++; }
    return Math.max(-MAX_BANK, Math.min(MAX_BANK, sum / c));
  });

  const frames: Frame[] = pos.map((p, i) => {
    const t = tan[i];
    const S = side0[i];
    const Nn = S.clone().cross(t);
    const b = bank[i];
    const side = S.clone().multiplyScalar(Math.cos(b)).addScaledVector(Nn, -Math.sin(b));
    const n = Nn.clone().multiplyScalar(Math.cos(b)).addScaledVector(S, Math.sin(b));
    const u = cpIdx[i];
    const i0 = Math.min(cps.length - 2, Math.floor(u));
    const f = u - i0;
    const wallH = cps[i0].wall + (cps[i0 + 1].wall - cps[i0].wall) * f;
    // b > 0 banks toward +side, so the outside of the turn is the −side wall
    const extra = Math.abs(b) * OUTER_WALL_GAIN;
    return {
      p, t, side, n,
      w: cps[i0].w + (cps[i0 + 1].w - cps[i0].w) * f,
      wall: wallH,
      wallL: wallH + (b > 0 ? extra : 0),
      wallR: wallH + (b < 0 ? extra : 0),
      gap: cps[i0 + 1].gap, // the segment ahead of this sample is open air
      roof: cps[i0 + 1].roof,
      s: i * DS,
    };
  });

  // Sweep the profile
  const P = profile(1, 1, 1).length;
  const positions = new Float32Array(N * P * 3);
  const uvs = new Float32Array(N * P * 2);
  frames.forEach((fr, i) => {
    profile(fr.w, fr.wallL, fr.wallR).forEach(([s, h], j) => {
      const v = fr.p.clone().addScaledVector(fr.side, s).addScaledVector(fr.n, h);
      positions.set([v.x, v.y, v.z], (i * P + j) * 3);
      uvs.set([j / (P - 1), fr.s / 6], (i * P + j) * 2);
    });
  });

  const floor: number[] = [];
  const wall: number[] = [];
  const gapRanges: [number, number][] = [];
  const runs: [number, number][] = [];
  let runStart = 0;
  for (let i = 0; i < N - 1; i++) {
    if (frames[i].gap) {
      if (runStart !== -1) { runs.push([runStart, i]); runStart = -1; }
      const last = gapRanges[gapRanges.length - 1];
      if (last && last[1] === frames[i].s) last[1] = frames[i + 1].s;
      else gapRanges.push([frames[i].s, frames[i + 1].s]);
      continue;
    }
    if (runStart === -1) runStart = i;
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = a + 1, c = a + P, d = c + 1;
      (FLOOR_SEGS.has(j) ? floor : wall).push(a, b, c, b, d, c);
    }
    if (frames[i].roof) {
      // Close the U across the wall tops
      const a = i * P + P - 1, b = i * P, c = a + P, d = b + P;
      wall.push(a, b, c, b, d, c);
    }
  }
  if (runStart !== -1) runs.push([runStart, N - 1]);

  // End caps (fan across the U) at each run's ends — stops marbles rolling off
  // the very start/end, and closes the tube look at jump lips.
  const capVerts: number[] = [];
  const capIdx: number[] = [];
  const base = N * P;
  let extra = 0;
  for (const [a, b] of runs) {
    for (const i of [a, b]) {
      if (i !== 0 && i !== N - 1) continue; // lips stay open
      const fr = frames[i];
      const centre = fr.p.clone().addScaledVector(fr.n, fr.wall / 2);
      capVerts.push(centre.x, centre.y, centre.z);
      const ci = base + extra++;
      for (let j = 0; j < P; j++) capIdx.push(ci, i * P + j, i * P + ((j + 1) % P));
    }
  }
  const allPos = new Float32Array(positions.length + capVerts.length);
  allPos.set(positions); allPos.set(capVerts, positions.length);
  const allUv = new Float32Array(uvs.length + extra * 2);
  allUv.set(uvs);
  const indices = new Uint32Array([...floor, ...wall, ...capIdx]);

  // Rails: lip lines per run, split at zone boundaries
  const zoneOf = (s: number) => {
    let z = 0;
    zones.forEach((zn, zi) => { if (s >= zn.s) z = zi; });
    return z;
  };
  const rails: BuiltTrack['rails'] = [];
  for (const [a, b] of runs) {
    for (const sign of [-1, 1]) {
      let cur: Vector3[] = [];
      let curZone = zoneOf(frames[a].s);
      for (let i = a; i <= b; i++) {
        const fr = frames[i];
        const z = zoneOf(fr.s);
        const v = fr.p.clone().addScaledVector(fr.side, (sign * fr.w) / 2).addScaledVector(fr.n, sign < 0 ? fr.wallL : fr.wallR);
        if (z !== curZone && cur.length > 1) {
          cur.push(v);
          rails.push({ pts: cur, zone: curZone });
          cur = [];
          curZone = z;
        }
        cur.push(v);
      }
      if (cur.length > 1) rails.push({ pts: cur, zone: curZone });
    }
  }

  const built: BuiltTrack = {
    def,
    gateS: remap(def.gateS),
    finishS: remap(def.finishS),
    spinners: def.spinners.map((f) => ({ ...f, s: remap(f.s) })),
    bumpers: def.bumpers.map((f) => ({ ...f, s: remap(f.s) })),
    punchers: def.punchers.map((f) => ({ ...f, s: remap(f.s) })),
    zones,
    cams: def.cams.map((c) => ({ ...c, from: remap(c.from), to: remap(c.to), ...(c.kind === 'fixed' ? { at: remap(c.at) } : {}) })),
    ds: DS, length, frames,
    positions: allPos, uvs: allUv, indices, floorIndexCount: floor.length,
    rails, gapRanges,
  };
  cache.set(def.id, built);
  return built;
}

/** Interpolated frame at arc length s. */
export function frameAt(tr: BuiltTrack, s: number): Frame {
  const f = Math.max(0, Math.min(tr.frames.length - 1.001, s / tr.ds));
  const i = Math.floor(f);
  const a = tr.frames[i], b = tr.frames[i + 1], u = f - i;
  return {
    p: a.p.clone().lerp(b.p, u),
    t: a.t.clone().lerp(b.t, u).normalize(),
    side: a.side.clone().lerp(b.side, u).normalize(),
    n: a.n.clone().lerp(b.n, u).normalize(),
    w: a.w + (b.w - a.w) * u,
    wall: a.wall + (b.wall - a.wall) * u,
    wallL: a.wallL + (b.wallL - a.wallL) * u,
    wallR: a.wallR + (b.wallR - a.wallR) * u,
    gap: a.gap,
    roof: a.roof,
    s,
  };
}

/** Nearest frame index to p, searching ±window around a hint (−1 = full search). */
export function locate(tr: BuiltTrack, x: number, y: number, z: number, hint: number, window = 30): number {
  const lo = hint < 0 ? 0 : Math.max(0, hint - window);
  const hi = hint < 0 ? tr.frames.length - 1 : Math.min(tr.frames.length - 1, hint + window);
  let best = lo, bd = Infinity;
  for (let i = lo; i <= hi; i++) {
    const p = tr.frames[i].p;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Orientation whose local Y is the floor normal and local Z is forward. */
export function frameQuat(fr: Frame): Quaternion {
  const x = fr.side.clone().negate();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, fr.n, fr.t));
}

/** Point on the track: lateral offset along the banked side, height along the normal. */
export function trackPoint(fr: Frame, offset: number, height: number): Vector3 {
  return fr.p.clone().addScaledVector(fr.side, offset).addScaledVector(fr.n, height);
}

/** Phase within a puncher's cycle, 0..1. */
export function puncherCycle(p: Puncher, t: number) {
  return (((t / p.period + p.phase) % 1) + 1) % 1;
}

/** How far the glove is punched out, 0 (inside the wall) .. 1 (full reach). */
export function puncherExtension(p: Puncher, t: number) {
  const u = puncherCycle(p, t);
  if (u < 0.08) { const k = u / 0.08; return 1 - (1 - k) * (1 - k); } // snap out
  if (u < 0.28) return 1;                                               // hold
  if (u < 0.55) { const k = (u - 0.28) / 0.27; return 1 - k * k * (3 - 2 * k); } // wind back
  return 0;
}

export function spinnerAngle(sp: Spinner, t: number) {
  return sp.phase + sp.omega * t;
}
