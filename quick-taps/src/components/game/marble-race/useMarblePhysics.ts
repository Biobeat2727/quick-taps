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
const TUNNEL_HALF_WIDTH = 30; // tunnel is 60px wide, marble constrained within
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

// ─── Tunnel geometry ──────────────────────────────────────────────────────────
// Each lane is a physical tunnel. Walls = centerX ± TUNNEL_HALF_WIDTH.
// Center positions at key y values mirror the crossing choreography:
//   y=800:  A=80,  B=160, C=230, D=310  (Act 1 exit spread)
//   y=1000: same   (parallel run before cross 1)
//   y=1100: A=230, B=310, C=80,  D=160  (cross 1 complete — A↔C, B↔D)
//   y=1300: same   (parallel run before cross 2)
//   y=1400: A=160, B=80,  C=310, D=230  (cross 2 complete — 180° swirl)
//   y=1600: same   (parallel run before cross 3)
//   y=1700: A=80,  B=160, C=230, D=310  (cross 3 complete — A↔B, C↔D)
//   y=1900: same   (parallel run before funnel)
//   y=2000: all    converge to x=195
//
// At crossing zones (y=1000–1100, 1300–1400, 1600–1700) the center x shifts
// linearly, so the tunnel walls shift with it. Tunnels from two lanes share the
// same spatial region mid-crossing — marbles follow whichever wall they contact.

type LaneKey = 'A' | 'B' | 'C' | 'D';

const TUNNEL_WAYPOINTS: Readonly<Record<LaneKey, ReadonlyArray<{ y: number; cx: number }>>> = {
  A: [
    { y: 800,  cx: 80  },
    { y: 1000, cx: 80  },
    { y: 1100, cx: 230 },
    { y: 1300, cx: 230 },
    { y: 1400, cx: 160 },
    { y: 1600, cx: 160 },
    { y: 1700, cx: 80  },
    { y: 1900, cx: 80  },
    { y: 2000, cx: 195 },
  ],
  B: [
    { y: 800,  cx: 160 },
    { y: 1000, cx: 160 },
    { y: 1100, cx: 310 },
    { y: 1300, cx: 310 },
    { y: 1400, cx: 80  },
    { y: 1600, cx: 80  },
    { y: 1700, cx: 160 },
    { y: 1900, cx: 160 },
    { y: 2000, cx: 195 },
  ],
  C: [
    { y: 800,  cx: 230 },
    { y: 1000, cx: 230 },
    { y: 1100, cx: 80  },
    { y: 1300, cx: 80  },
    { y: 1400, cx: 310 },
    { y: 1600, cx: 310 },
    { y: 1700, cx: 230 },
    { y: 1900, cx: 230 },
    { y: 2000, cx: 195 },
  ],
  D: [
    { y: 800,  cx: 310 },
    { y: 1000, cx: 310 },
    { y: 1100, cx: 160 },
    { y: 1300, cx: 160 },
    { y: 1400, cx: 230 },
    { y: 1600, cx: 230 },
    { y: 1700, cx: 310 },
    { y: 1900, cx: 310 },
    { y: 2000, cx: 195 },
  ],
};

function getTunnelWalls(lane: LaneKey, y: number): { left: number; right: number } {
  const wps = TUNNEL_WAYPOINTS[lane];

  if (y <= wps[0].y) {
    return { left: wps[0].cx - TUNNEL_HALF_WIDTH, right: wps[0].cx + TUNNEL_HALF_WIDTH };
  }
  const last = wps[wps.length - 1];
  if (y >= last.y) {
    return { left: last.cx - TUNNEL_HALF_WIDTH, right: last.cx + TUNNEL_HALF_WIDTH };
  }

  for (let i = 1; i < wps.length; i++) {
    if (y <= wps[i].y) {
      const t = (y - wps[i - 1].y) / (wps[i].y - wps[i - 1].y);
      const cx = wps[i - 1].cx + t * (wps[i].cx - wps[i - 1].cx);
      return { left: cx - TUNNEL_HALF_WIDTH, right: cx + TUNNEL_HALF_WIDTH };
    }
  }

  return { left: last.cx - TUNNEL_HALF_WIDTH, right: last.cx + TUNNEL_HALF_WIDTH };
}

function assignLane(x: number): LaneKey {
  // Thresholds are midpoints between adjacent tunnel walls.
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
  /** Cartesian velocity — used in Acts 1 and 2 */
  vx: number;
  vy: number;
  /** 0.88–1.12, fixed for the whole race */
  speedMod: number;
  act: MarbleAct;
  // ── Act 2 ──
  lane: LaneKey | null;
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
    // Acts 1 & 2: elastic Cartesian collision (marbles carry real velocity in both)
    const act1 = ms.filter(m => m.act === 1 && !m.finished);
    for (let i = 0; i < act1.length; i++) {
      for (let j = i + 1; j < act1.length; j++) {
        resolveCartesianCollision(act1[i], act1[j]);
      }
    }

    const act2 = ms.filter(m => m.act === 2 && !m.finished);
    for (let i = 0; i < act2.length; i++) {
      for (let j = i + 1; j < act2.length; j++) {
        resolveCartesianCollision(act2[i], act2[j]);
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

  // Transition to Act 2 — velocity carries over, position unchanged
  if (m.y >= ACT1_EXIT_Y) {
    m.act = 2;
    m.lane = assignLane(m.x);
  }
}

// ─── Act 2 — Crossing tunnels (wall-bounce physics) ───────────────────────────
// Marbles move under gravity with their Act 1 velocity, bouncing off the left
// and right walls of their assigned tunnel. Tunnel walls shift laterally at
// crossing zones, guiding marbles through the choreography naturally.
// At crossings the tunnels share physical space — marble-marble elastic
// collisions (applied in step()) determine who goes where.

function stepAct2(m: MarbleState): void {
  if (!m.lane) return;

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

  // Tunnel wall bounce
  const { left, right } = getTunnelWalls(m.lane, m.y);
  if (m.x - MARBLE_RADIUS < left) {
    m.x = left + MARBLE_RADIUS;
    m.vx = Math.abs(m.vx) * WALL_DAMPING;
  } else if (m.x + MARBLE_RADIUS > right) {
    m.x = right - MARBLE_RADIUS;
    m.vx = -Math.abs(m.vx) * WALL_DAMPING;
  }

  // Transition to Act 3
  if (m.y >= ACT2_EXIT_Y) {
    m.act = 3;
    m.radius = FUNNEL_OUTER_RADIUS;
    m.angle = FUNNEL_ENTRY_ANGLE; // -π/2 → top of funnel rim
    m.x = FUNNEL_CENTER_X + m.radius * Math.cos(m.angle);
    m.y = FUNNEL_CENTER_Y + m.radius * Math.sin(m.angle);
    m.vr = 0;
    // Lanes A & B started on the left → clockwise spin; C & D → counter-clockwise.
    const spin = (m.lane === 'A' || m.lane === 'B') ? 1 : -1;
    const vTangential = 2.5 * m.speedMod;
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

/** Elastic Cartesian collision, equal mass (used in Acts 1 and 2). */
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
