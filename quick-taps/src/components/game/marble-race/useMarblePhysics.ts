import { useRef, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAVITY = 0.05; // px/frame²
const MAX_VELOCITY = 5; // px/frame
const MARBLE_RADIUS = 8; // 16px diameter

// Act 1
const WALL_LEFT = 40;
const WALL_RIGHT = 350;
const WALL_DAMPING = 0.6;
const PEG_RADIUS = 6;
const PEG_DAMPING = 0.7;
const PEG_LATERAL_IMPULSE = 2;
const ACT1_EXIT_Y = 800;

// Act 2
const ACT2_BASE_SPEED = 1.5; // px/frame along path
const ACT2_EXIT_Y = 2000;

// Act 3
const FUNNEL_CENTER_X = 195;
const FUNNEL_CENTER_Y = 2200;
const FUNNEL_OUTER_RADIUS = 140;
const FUNNEL_HOLE_RADIUS = 20;
const FUNNEL_RADIAL_ACCEL = 0.03; // inward pull (gravity along funnel wall)
const FUNNEL_ENTRY_ANGLE = -Math.PI / 2; // marble enters at top of funnel rim

// ─── Peg grid ─────────────────────────────────────────────────────────────────
// 8 rows staggered. Even rows (0-indexed): 5 pegs. Odd rows: 4 pegs.
// Horizontal spacing 60px, vertical spacing 80px, first row at y=80.

const PEGS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const pegs: { x: number; y: number }[] = [];
  for (let row = 0; row < 8; row++) {
    const y = 80 + row * 80;
    const xs = row % 2 === 0
      ? [75, 135, 195, 255, 315]
      : [105, 165, 225, 285];
    for (const x of xs) pegs.push({ x, y });
  }
  return pegs;
})();

// ─── Lane paths ───────────────────────────────────────────────────────────────
// Waypoints [x, y] define the cubic piecewise-linear path for each lane.
//
// Crossings (using the marble's original lane label, not its physical position):
//   Entry  y=800:  A=80,  B=160, C=230, D=310
//   Cross1 y=1100: A=230, B=310, C=80,  D=160  (A↔C, B↔D)
//   Cross2 y=1400: A=160, B=80,  C=310, D=230  (180° clockwise swirl)
//   Cross3 y=1700: A=80,  B=160, C=230, D=310  (A↔B, C↔D → back to original)
//   Exit   y=2000: all converge to x=195

type LaneKey = 'A' | 'B' | 'C' | 'D';
type Waypoint = readonly [number, number];

const LANE_PATHS: Readonly<Record<LaneKey, ReadonlyArray<Waypoint>>> = {
  A: [
    [80,  800], [80,  1000], [230, 1100],
    [230, 1300], [160, 1400], [160, 1600],
    [80,  1700], [80,  1900], [195, 2000],
  ],
  B: [
    [160, 800], [160, 1000], [310, 1100],
    [310, 1300], [80,  1400], [80,  1600],
    [160, 1700], [160, 1900], [195, 2000],
  ],
  C: [
    [230, 800], [230, 1000], [80,  1100],
    [80,  1300], [310, 1400], [310, 1600],
    [230, 1700], [230, 1900], [195, 2000],
  ],
  D: [
    [310, 800], [310, 1000], [160, 1100],
    [160, 1300], [230, 1400], [230, 1600],
    [310, 1700], [310, 1900], [195, 2000],
  ],
};

// Precompute cumulative segment lengths for t-parameter interpolation.
const LANE_CUM_LENGTHS: Readonly<Record<LaneKey, ReadonlyArray<number>>> = (() => {
  const result = {} as Record<LaneKey, number[]>;
  for (const key of ['A', 'B', 'C', 'D'] as LaneKey[]) {
    const wps = LANE_PATHS[key];
    const cum: number[] = [0];
    for (let i = 1; i < wps.length; i++) {
      const dx = wps[i][0] - wps[i - 1][0];
      const dy = wps[i][1] - wps[i - 1][1];
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    result[key] = cum;
  }
  return result;
})();

function lanePathLength(lane: LaneKey): number {
  const cum = LANE_CUM_LENGTHS[lane];
  return cum[cum.length - 1];
}

function interpolateLane(lane: LaneKey, t: number): { x: number; y: number } {
  const wps = LANE_PATHS[lane];
  const cum = LANE_CUM_LENGTHS[lane];
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(1, t)) * total;

  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1];
      const u = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      return {
        x: wps[i - 1][0] + u * (wps[i][0] - wps[i - 1][0]),
        y: wps[i - 1][1] + u * (wps[i][1] - wps[i - 1][1]),
      };
    }
  }
  const last = wps[wps.length - 1];
  return { x: last[0], y: last[1] };
}

function assignLane(x: number): LaneKey {
  if (x < 120) return 'A';
  if (x < 195) return 'B';
  if (x < 270) return 'C';
  return 'D';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarbleAct = 1 | 2 | 3;

export interface MarbleState {
  id: string;
  /** Cartesian position — valid in all acts */
  x: number;
  y: number;
  /** Cartesian velocity — used in Act 1 */
  vx: number;
  vy: number;
  /** 0.88–1.12, fixed for the whole race */
  speedMod: number;
  act: MarbleAct;
  // ── Act 2 ──
  lane: LaneKey | null;
  /** Progress along lane path, 0–1 */
  laneT: number;
  // ── Act 3 (polar) ──
  /** Angle from funnel center (radians) */
  angle: number;
  /** Distance from funnel center (px) */
  radius: number;
  /** Radial velocity — negative means moving toward center */
  vr: number;
  /** L = r² × ω, signed — conserved through Act 3 */
  angularMomentum: number;
  // ── Results ──
  finished: boolean;
  placement: number | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMarblePhysicsResult {
  /** Live marble state — mutated in place each frame, do not render from directly */
  marbles: React.MutableRefObject<MarbleState[]>;
  /** Ordered list of finished marble ids (1st finisher at index 0) */
  placements: React.MutableRefObject<string[]>;
  /** Initialise marbles from an array of ids; must be called before the first step */
  initMarbles: (ids: string[]) => void;
  /** Advance all marbles by one physics frame */
  step: () => void;
}

export function useMarblePhysics(): UseMarblePhysicsResult {
  const marbles = useRef<MarbleState[]>([]);
  const placements = useRef<string[]>([]);

  const initMarbles = useCallback((ids: string[]) => {
    placements.current = [];
    marbles.current = ids.map((id, i) => {
      // Spread entry x slightly so marbles don't stack at the exact centre.
      const spreadX = FUNNEL_CENTER_X + (i - (ids.length - 1) / 2) * 4;
      return {
        id,
        x: spreadX,
        y: 0,
        vx: 0,
        vy: 0,
        speedMod: 0.88 + Math.random() * 0.24,
        act: 1 as MarbleAct,
        lane: null,
        laneT: 0,
        angle: 0,
        radius: FUNNEL_OUTER_RADIUS,
        vr: 0,
        angularMomentum: 0,
        finished: false,
        placement: null,
      };
    });
  }, []);

  const step = useCallback(() => {
    const ms = marbles.current;

    // ── Per-marble step ──────────────────────────────────────────────────────
    for (const m of ms) {
      if (m.finished) continue;
      if (m.act === 1) stepAct1(m);
      else if (m.act === 2) stepAct2(m);
      else stepAct3(m, placements.current);
    }

    // ── Marble-marble collisions ─────────────────────────────────────────────
    // Act 1: elastic Cartesian collision
    const act1 = ms.filter(m => m.act === 1 && !m.finished);
    for (let i = 0; i < act1.length; i++) {
      for (let j = i + 1; j < act1.length; j++) {
        resolveCartesianCollision(act1[i], act1[j]);
      }
    }

    // Act 2: same-lane separation (marbles on different lanes pass through crossings)
    const act2 = ms.filter(m => m.act === 2 && !m.finished);
    for (let i = 0; i < act2.length; i++) {
      for (let j = i + 1; j < act2.length; j++) {
        resolveAct2LaneCollision(act2[i], act2[j]);
      }
    }

    // Act 3: Cartesian nudge, then re-derive polar state
    const act3 = ms.filter(m => m.act === 3 && !m.finished);
    for (let i = 0; i < act3.length; i++) {
      for (let j = i + 1; j < act3.length; j++) {
        resolveAct3Collision(act3[i], act3[j]);
      }
    }
  }, []);

  return { marbles, placements, initMarbles, step };
}

// ─── Act 1 — Plinko drop ─────────────────────────────────────────────────────

function stepAct1(m: MarbleState): void {
  // Gravity
  m.vy += GRAVITY * m.speedMod;

  // Speed cap
  const speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  if (speed > MAX_VELOCITY) {
    const s = MAX_VELOCITY / speed;
    m.vx *= s;
    m.vy *= s;
  }

  // Integrate
  m.x += m.vx;
  m.y += m.vy;

  // Channel wall bounce
  if (m.x - MARBLE_RADIUS < WALL_LEFT) {
    m.x = WALL_LEFT + MARBLE_RADIUS;
    m.vx = Math.abs(m.vx) * WALL_DAMPING;
  } else if (m.x + MARBLE_RADIUS > WALL_RIGHT) {
    m.x = WALL_RIGHT - MARBLE_RADIUS;
    m.vx = -Math.abs(m.vx) * WALL_DAMPING;
  }

  // Peg collisions
  for (const peg of PEGS) {
    const dx = m.x - peg.x;
    const dy = m.y - peg.y;
    const distSq = dx * dx + dy * dy;
    const minDist = MARBLE_RADIUS + PEG_RADIUS;
    if (distSq < minDist * minDist && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      // Push out
      m.x = peg.x + nx * minDist;
      m.y = peg.y + ny * minDist;
      // Reflect + damp
      const dot = m.vx * nx + m.vy * ny;
      m.vx = (m.vx - 2 * dot * nx) * PEG_DAMPING;
      m.vy = (m.vy - 2 * dot * ny) * PEG_DAMPING;
      // Random lateral impulse to break determinism
      m.vx += (Math.random() * 2 - 1) * PEG_LATERAL_IMPULSE;
    }
  }

  // Transition to Act 2
  if (m.y >= ACT1_EXIT_Y) {
    m.act = 2;
    m.lane = assignLane(m.x);
    m.laneT = 0;
    m.vx = 0;
    m.vy = 0;
    const start = interpolateLane(m.lane, 0);
    m.x = start.x;
    m.y = start.y;
  }
}

// ─── Act 2 — Crossing lanes ───────────────────────────────────────────────────

function stepAct2(m: MarbleState): void {
  if (!m.lane) return;

  const dtPerFrame = (ACT2_BASE_SPEED * m.speedMod) / lanePathLength(m.lane);
  m.laneT = Math.min(1, m.laneT + dtPerFrame);

  const pos = interpolateLane(m.lane, m.laneT);
  m.x = pos.x;
  m.y = pos.y;

  // Transition to Act 3
  if (m.laneT >= 1) {
    m.act = 3;
    // All lanes exit at (195, 2000); place marble on funnel outer rim directly above centre.
    m.radius = FUNNEL_OUTER_RADIUS;
    m.angle = FUNNEL_ENTRY_ANGLE; // -π/2 → top of funnel rim: (195, 2060)
    m.x = FUNNEL_CENTER_X + m.radius * Math.cos(m.angle);
    m.y = FUNNEL_CENTER_Y + m.radius * Math.sin(m.angle);
    m.vr = 0;
    // Lanes A & B entered from the left → clockwise (+1)
    // Lanes C & D entered from the right → counter-clockwise (-1)
    const spin = (m.lane === 'A' || m.lane === 'B') ? 1 : -1;
    const vTangential = 2.5 * m.speedMod;
    // L = r² × ω = r × v_tangential
    m.angularMomentum = spin * m.radius * vTangential;
  }
}

// ─── Act 3 — Funnel ───────────────────────────────────────────────────────────

function stepAct3(m: MarbleState, placements: string[]): void {
  // Inward radial pull (gravity component along funnel wall)
  m.vr -= FUNNEL_RADIAL_ACCEL;
  m.radius += m.vr;

  // Outer wall bounce
  if (m.radius >= FUNNEL_OUTER_RADIUS) {
    m.radius = FUNNEL_OUTER_RADIUS;
    m.vr = -Math.abs(m.vr) * WALL_DAMPING;
  }

  // Angular velocity from conserved angular momentum: ω = L / r²
  const omega = m.angularMomentum / (m.radius * m.radius);
  m.angle += omega;

  // Update Cartesian from polar
  m.x = FUNNEL_CENTER_X + m.radius * Math.cos(m.angle);
  m.y = FUNNEL_CENTER_Y + m.radius * Math.sin(m.angle);

  // Exit through hole
  if (m.radius <= FUNNEL_HOLE_RADIUS) {
    m.finished = true;
    m.placement = placements.length + 1;
    placements.push(m.id);
    m.x = FUNNEL_CENTER_X;
    m.y = FUNNEL_CENTER_Y + FUNNEL_HOLE_RADIUS; // drop to hole
  }
}

// ─── Collision helpers ────────────────────────────────────────────────────────

/** Elastic Cartesian collision, equal mass (used in Act 1). */
function resolveCartesianCollision(a: MarbleState, b: MarbleState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = MARBLE_RADIUS * 2;
  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (minDist - dist) / 2;

  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const dot = dvx * nx + dvy * ny;
  if (dot >= 0) return; // already separating

  a.vx += dot * nx;
  a.vy += dot * ny;
  b.vx -= dot * nx;
  b.vy -= dot * ny;
}

/**
 * Act 2 same-lane collision.
 * Cross-lane collisions are intentionally ignored — marbles on different lane
 * paths pass through crossing zones on separate chutes.
 */
function resolveAct2LaneCollision(a: MarbleState, b: MarbleState): void {
  if (a.lane !== b.lane || !a.lane) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = MARBLE_RADIUS * 2;
  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const needed = minDist - dist;
  // Push apart along the lane by adjusting laneT
  const totalLen = lanePathLength(a.lane);
  const dt = (needed / 2) / totalLen;

  // The marble further along the path (higher laneT) is "in front"
  const [front, rear] = a.laneT >= b.laneT ? [a, b] : [b, a];
  front.laneT = Math.min(1, front.laneT + dt);
  rear.laneT  = Math.max(0, rear.laneT  - dt);

  const fp = interpolateLane(front.lane!, front.laneT);
  const rp = interpolateLane(rear.lane!,  rear.laneT);
  front.x = fp.x; front.y = fp.y;
  rear.x  = rp.x; rear.y  = rp.y;
}

/**
 * Act 3 collision — nudge in Cartesian space, re-derive polar state.
 * Angular momentum is not exchanged; only positions are corrected.
 */
function resolveAct3Collision(a: MarbleState, b: MarbleState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = MARBLE_RADIUS * 2;
  if (distSq >= minDist * minDist || distSq === 0) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (minDist - dist) / 2;

  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  // Re-derive polar from updated Cartesian
  for (const m of [a, b]) {
    const mdx = m.x - FUNNEL_CENTER_X;
    const mdy = m.y - FUNNEL_CENTER_Y;
    m.radius = Math.max(FUNNEL_HOLE_RADIUS, Math.sqrt(mdx * mdx + mdy * mdy));
    m.angle  = Math.atan2(mdy, mdx);
  }
}
