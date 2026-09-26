// Isomorphic bowling simulation — no 'use client', no Node APIs.
// Takes the Rapier module as an argument so the browser (instant local throws)
// and the server can share one physics definition.

import type RAPIER_T from '@dimforge/rapier3d-compat';
import { PIN_POSITIONS, LANE_HALF_WIDTH, BALL_RADIUS } from '@/lib/bowling/bowling-constants';

type Rapier = typeof RAPIER_T;

export const SIM_HZ = 60;
const MAX_FRAMES = 540; // 9s
const NUM_PINS = 10;
export const PIN_STRIDE = 7;  // x,y,z, qx,qy,qz,qw
export const BALL_STRIDE = 7; // x,y,z, qx,qy,qz,qw

export interface BowlThrow {
  startX: number;    // lane position at release, clamped ±0.45
  direction: number; // radians off straight, +right
  speed: number;     // m/s at release (real bowlers: 7–9)
  spin: number;      // −1..1 — hook strength, +right
  pinState: boolean[];
  /** Scales the per-rack pin variation (0 = perfectly repeatable, for calibration). Default 1. */
  variance?: number;
  rand?: () => number;
}

export interface BowlSimResult {
  numFrames: number;
  ballFrames: Float32Array; // numFrames × BALL_STRIDE
  pinFrames: Float32Array;  // numFrames × NUM_PINS × PIN_STRIDE
  knockedPins: boolean[];   // newly knocked this throw
  impactFrame: number;      // first frame a pin moves (−1 = none)
  gutterFrame: number;      // first frame the ball drops into a gutter (−1 = none)
  /** At first pin contact: ball x (m) and entry angle toward the head pin's line (rad, <0 = drifting away). */
  entry: { x: number; angle: number } | null;
  /**
   * Collisions for sound, in order: [frame, kind, strength 0..1, x] per hit.
   * kind: 0 ball→pin, 1 pin→pin, 2 pin→deck/lane, 3 pin→kickback/gutter, 4 into the pit.
   */
  hits: [number, HitKind, number, number][];
}

export const HitKind = { BallPin: 0, PinPin: 1, PinDeck: 2, PinWall: 3, Pit: 4 } as const;
export type HitKind = (typeof HitKind)[keyof typeof HitKind];

// Contact-force thresholds (Rapier force units for these masses), from sampling
// real throws: below HIT_MIN is resting contact; HIT_FULL maps to strength 1.
const HIT_MIN = 0.35;
const HIT_FULL = 40;
const HIT_GAP_FRAMES = 5; // the same pair can't retrigger faster than this

// The hook ramps in from a third of the way down, so a curved throw visibly
// sweeps across the lane (a late, sudden hook read as "nothing, then too much").
const HOOK_START = 4.0;
const HOOK_FULL = 10.0;

/** Physics tuning knobs — exported so offline calibration scripts can sweep them. */
export const TUNING = {
  hookAccel: 0.9,       // m/s² lateral at spin = 1 (≈0.5–0.7 m of break at a normal pace)
  ballDensity: 4.5,     // ball:pin mass ≈ 4.8:1, close to a 15 lb ball vs 3.5 lb pin
  pinRestitution: 0.5,
  pinFriction: 0.2,
  pinLinDamp: 0.15,
  pinAngDamp: 0.8,
  pinBellyR: 0.0605,    // collider radius = a real pin's belly
  carry: 0.7,           // 0..1 — pocket-hit deflection assist; 0.7 ≈ 60–70% strikes on pocket hits
  // ── Rework: make it a skill game, not a spot to spam ──
  carryEntryFull: 0.05, // rad of entry angle (~3°) for full carry (0 = angle ignored)
  carryEntryMin: 0.45,  // share of carry a dead-straight ball still gets
  carryJitter: 0.25,    // ± share of carry, per throw
  pocketAngleWiden: 0.045, // m the pocket's light edge extends for a fully angled ball
  pinSpotJitter: 0.003, // m σ — pinsetters never spot perfectly
  pinTiltJitter: 0.006, // rad σ
  pinFrictionJitter: 0.15, // ± share of pin friction/restitution, per rack
};

function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function runBowlSim(RAPIER: Rapier, t: BowlThrow): BowlSimResult {
  const rand = t.rand ?? Math.random;
  const vary = t.variance ?? 1;
  const carryShare = Math.max(0, 1 + (rand() * 2 - 1) * TUNING.carryJitter * vary);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / SIM_HZ;

  const fixed = (x: number, y: number, z: number) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));

  // Collider tags, so contact events can be voiced: 'lane' | 'wall' | 'pit' | 'ball' | pin index
  const tag = new Map<number, 'lane' | 'wall' | 'pit' | 'ball' | number>();
  const tagged = (c: RAPIER_T.Collider, t: 'lane' | 'wall' | 'pit' | 'ball' | number) => { tag.set(c.handle, t); return c; };
  const EV = RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;

  // Lane — ends just past the deck; ball and pins drop into the pit beyond.
  tagged(world.createCollider(
    RAPIER.ColliderDesc.cuboid(LANE_HALF_WIDTH, 0.01, 9.5).setFriction(0.12).setRestitution(0.3),
    fixed(0, -0.01, 9.0),
  ), 'lane');
  for (const sx of [-1, 1]) {
    // Gutter floor at the bottom of the visual trough
    tagged(world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.125, 0.01, 9.5).setFriction(0.05).setRestitution(0.1),
      fixed(sx * 0.655, -0.25, 9.0),
    ), 'wall');
    // Outer wall / kickback
    tagged(world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.01, 0.35, 10).setFriction(0.1).setRestitution(0.35),
      fixed(sx * 0.78, 0.1, 9.5),
    ), 'wall');
  }
  // Pit floor + back cushion
  tagged(world.createCollider(
    RAPIER.ColliderDesc.cuboid(2.0, 0.01, 2.5).setFriction(0.8).setRestitution(0.0),
    fixed(0, -0.6, 20.5),
  ), 'pit');
  tagged(world.createCollider(
    RAPIER.ColliderDesc.cuboid(2.0, 1.0, 0.05).setFriction(0.8).setRestitution(0.05),
    fixed(0, 0.2, 21.2),
  ), 'pit');

  // Pins — 3-collider compound (flat base for stable standing, belly + neck capsules).
  // (Why this shape: see git history for the v1 docs/BOWLING.md "Pin Physics".)
  const pins: (RAPIER_T.RigidBody | null)[] = [];
  const spawn: [number, number][] = []; // where each pin was actually set (spots are jittered)
  for (let i = 0; i < NUM_PINS; i++) {
    if (!t.pinState[i]) { pins.push(null); continue; }
    const [px0, py, pz0] = PIN_POSITIONS[i];
    // Real pins sit a hair off their spots, with a slight lean and their own wear
    const px = px0 + gauss(rand) * TUNING.pinSpotJitter * vary;
    const pz = pz0 + gauss(rand) * TUNING.pinSpotJitter * vary;
    const tx = gauss(rand) * TUNING.pinTiltJitter * vary, tz = gauss(rand) * TUNING.pinTiltJitter * vary;
    const fr = 1 + (rand() * 2 - 1) * TUNING.pinFrictionJitter * vary;
    spawn[i] = [px, pz];
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz)
        .setRotation({ x: Math.sin(tx / 2), y: 0, z: Math.sin(tz / 2), w: Math.cos(tx / 2) * Math.cos(tz / 2) })
        .setAngularDamping(TUNING.pinAngDamp).setLinearDamping(TUNING.pinLinDamp),
    );
    tagged(world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.001, 0.025).setTranslation(0, -0.19, 0)
        .setFriction(0.25).setRestitution(0.1).setDensity(1.0)
        .setActiveEvents(EV).setContactForceEventThreshold(HIT_MIN), b), i);
    tagged(world.createCollider(
      RAPIER.ColliderDesc.capsule(0.11, TUNING.pinBellyR).setTranslation(0, -0.02, 0)
        .setFriction(TUNING.pinFriction * fr).setRestitution(TUNING.pinRestitution * fr).setDensity(2.0)
        .setActiveEvents(EV).setContactForceEventThreshold(HIT_MIN), b), i);
    tagged(world.createCollider(
      RAPIER.ColliderDesc.capsule(0.018, 0.022).setTranslation(0, 0.155, 0)
        .setFriction(TUNING.pinFriction * fr).setRestitution(TUNING.pinRestitution * fr).setDensity(0.5)
        .setActiveEvents(EV).setContactForceEventThreshold(HIT_MIN), b), i);
    pins.push(b);
  }

  // Ball
  const startX = Math.max(-0.45, Math.min(0.45, t.startX));
  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(startX, BALL_RADIUS, 0.3).setCcdEnabled(true),
  );
  tagged(world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setFriction(0.2).setRestitution(0.35).setDensity(TUNING.ballDensity)
      .setActiveEvents(EV).setContactForceEventThreshold(HIT_MIN),
    ball,
  ), 'ball');
  const speed = Math.max(2, Math.min(10, t.speed));
  ball.setLinvel({ x: Math.sin(t.direction) * speed, y: 0, z: Math.cos(t.direction) * speed }, true);
  ball.setAngvel({ x: speed / BALL_RADIUS, y: 0, z: 0 }, true);
  const ballMass = ball.mass();

  const ballFrames = new Float32Array(MAX_FRAMES * BALL_STRIDE);
  const pinFrames = new Float32Array(MAX_FRAMES * NUM_PINS * PIN_STRIDE);
  let impactFrame = -1;
  const boosted = new Array(NUM_PINS).fill(false);
  let pocketQ = -1, impactBallX = 0;
  let entry: BowlSimResult['entry'] = null;
  let gutterFrame = -1;
  let numFrames = 0;
  const dt = 1 / SIM_HZ;

  // Entry: the ball's line as it arrives on the pin deck (just short of the
  // head pin). Measured here, not at "impact" — a pin only registers as moved a
  // few frames after contact, by which point the ball has already deflected.
  const DECK_Z = 17.25;
  const events = new RAPIER.EventQueue(true);
  const pairForce = new Map<string, { force: number; f: number }>();
  const hits: BowlSimResult['hits'] = [];
  const preV = { x: 0, z: 1 };
  const preP = { x: startX };
  let deckSeen = false;

  for (let f = 0; f < MAX_FRAMES; f++) {
    const bp = ball.translation();
    if (!deckSeen && bp.z >= DECK_Z) {
      deckSeen = true;
      const bv = ball.linvel();
      preV.x = bv.x; preV.z = bv.z; preP.x = bp.x;
    }

    // Hook — lateral push on the dry backend while the ball is still rolling on the lane.
    if (gutterFrame < 0 && bp.y > 0.05 && bp.z < 17.2 && Math.abs(bp.x) < LANE_HALF_WIDTH) {
      const u = Math.min(1, Math.max(0, (bp.z - HOOK_START) / (HOOK_FULL - HOOK_START)));
      const ramp = u * u * (3 - 2 * u);
      if (ramp > 0) ball.applyImpulse({ x: t.spin * TUNING.hookAccel * ramp * ballMass * dt, y: 0, z: 0 }, true);
    }

    world.step(events);

    // Collisions → sound. Only a new or suddenly harder contact counts; pins
    // resting on each other or the deck push steadily and must stay silent.
    events.drainContactForceEvents((e) => {
      const a = tag.get(e.collider1()), b = tag.get(e.collider2());
      if (a === undefined || b === undefined) return;
      const force = e.totalForceMagnitude();
      const key = e.collider1() < e.collider2() ? `${e.collider1()}:${e.collider2()}` : `${e.collider2()}:${e.collider1()}`;
      const prev = pairForce.get(key);
      pairForce.set(key, { force, f });
      if (prev && f - prev.f < HIT_GAP_FRAMES && force < prev.force * 2.5) return;
      let kind: HitKind | null = null;
      const pinA = typeof a === 'number', pinB = typeof b === 'number';
      if ((a === 'ball' && pinB) || (b === 'ball' && pinA)) kind = HitKind.BallPin;
      else if (pinA && pinB) { if (a !== b) kind = HitKind.PinPin; }
      else if (pinA || pinB) {
        const other = pinA ? b : a;
        kind = other === 'lane' ? HitKind.PinDeck : other === 'wall' ? HitKind.PinWall : other === 'pit' ? HitKind.Pit : null;
      } else if ((a === 'ball' && b === 'pit') || (b === 'ball' && a === 'pit')) kind = HitKind.Pit;
      if (kind === null) return;
      if (kind === HitKind.PinDeck && force < HIT_MIN * 1.5) return; // settling wobble
      const strength = Math.min(1, Math.log1p(force / HIT_MIN) / Math.log1p(HIT_FULL / HIT_MIN));
      const pinIdx = pinA ? (a as number) : pinB ? (b as number) : -1;
      const x = pinIdx >= 0 && pins[pinIdx] ? pins[pinIdx]!.translation().x : ball.translation().x;
      if (hits.length < 400) hits.push([f, kind, Math.round(strength * 100) / 100, Math.round(x * 100) / 100]);
    });

    // Carry: rigid capsules get shoved straight back, but real pins deflect sideways
    // off the ball's path and cascade across the deck (head pin → 3 → 6 → 10). On a
    // pocket hit, the first time each pin starts moving, guarantee it a share of
    // lateral motion away from the ball's line. Scaled by pocket quality, so an
    // off-target ball earns nothing.
    if (TUNING.carry > 0 && impactFrame >= 0) {
      if (pocketQ < 0) {
        const bx = preP.x;
        const ax = Math.abs(bx);
        // A ball driving in at an angle has a bigger strike window than a straight
        // one (as in real bowling) — so a hook forgives a little wobble in the curve.
        const angIn = Math.max(0, Math.atan2(-Math.sign(bx || 1) * preV.x, Math.max(0.1, preV.z)));
        const wide = Math.min(1, angIn / Math.max(1e-6, TUNING.carryEntryFull)) * TUNING.pocketAngleWiden;
        const hi = 0.115 + wide;
        pocketQ = ax >= 0.025 && ax <= hi ? 1 : ax < 0.025 ? ax / 0.025 : Math.max(0, 1 - (ax - hi) / 0.1);
        impactBallX = bx;
        entry = { x: bx, angle: Math.atan2(-Math.sign(bx || 1) * preV.x, Math.max(0.1, preV.z)) };
        // Entry angle: a ball driving into the pocket at an angle carries; a
        // dead-straight one deflects and leaves corner pins.
        if (TUNING.carryEntryFull > 0) {
          const into = -Math.sign(bx) * preV.x;            // lateral speed toward the head pin's line
          const ang = Math.atan2(Math.max(0, into), Math.max(0.1, preV.z));
          const f = Math.min(1, ang / TUNING.carryEntryFull);
          pocketQ *= TUNING.carryEntryMin + (1 - TUNING.carryEntryMin) * f;
        }
        pocketQ *= carryShare;
      }
      const minLat = Math.min(0.95, TUNING.carry * pocketQ);
      for (let i = 0; minLat > 0 && i < NUM_PINS; i++) {
        const b = pins[i];
        if (!b || boosted[i]) continue;
        const lv = b.linvel();
        const h = Math.hypot(lv.x, lv.z);
        if (h < 0.25) continue;
        boosted[i] = true;
        const away = Math.sign(PIN_POSITIONS[i][0] - impactBallX) || Math.sign(-impactBallX);
        const lat = lv.x * away;
        if (lat >= minLat * h) continue;
        const nx = away * minLat * h;
        const nz = Math.sign(lv.z || 1) * Math.sqrt(Math.max(0, h * h - nx * nx));
        b.setLinvel({ x: nx, y: lv.y, z: nz }, true);
      }
    }

    const p = ball.translation();
    const q = ball.rotation();
    const bo = f * BALL_STRIDE;
    ballFrames[bo] = p.x; ballFrames[bo + 1] = p.y; ballFrames[bo + 2] = p.z;
    ballFrames[bo + 3] = q.x; ballFrames[bo + 4] = q.y; ballFrames[bo + 5] = q.z; ballFrames[bo + 6] = q.w;
    if (gutterFrame < 0 && p.z < 17.2 && Math.abs(p.x) > LANE_HALF_WIDTH + 0.02 && p.y < 0.05) gutterFrame = f;

    for (let i = 0; i < NUM_PINS; i++) {
      const o = (f * NUM_PINS + i) * PIN_STRIDE;
      const b = pins[i];
      if (!b) {
        // Already down before this throw — parked out of sight under the deck.
        const [px, , pz] = PIN_POSITIONS[i];
        pinFrames[o] = px; pinFrames[o + 1] = -5; pinFrames[o + 2] = pz;
        pinFrames[o + 6] = 1;
        continue;
      }
      const pp = b.translation();
      const pq = b.rotation();
      pinFrames[o] = pp.x; pinFrames[o + 1] = pp.y; pinFrames[o + 2] = pp.z;
      pinFrames[o + 3] = pq.x; pinFrames[o + 4] = pq.y; pinFrames[o + 5] = pq.z; pinFrames[o + 6] = pq.w;
      if (impactFrame < 0) {
        const [px, pz] = spawn[i];
        if (Math.abs(pp.x - px) + Math.abs(pp.z - pz) > 0.01) impactFrame = f;
      }
    }
    numFrames = f + 1;

    if (f > 60 && world.bodies.getAll().every(b => b.isSleeping() || b.isFixed())) break;
    // Ball gone into the pit and nothing is still moving meaningfully
    if (f > 60 && p.z > 19.5 && pins.every(b => !b || b.isSleeping() || b.translation().y < -0.3)) break;
  }

  const knockedPins = t.pinState.map((standing, i) => {
    const b = pins[i];
    if (!standing || !b) return false;
    const p = b.translation();
    const q = b.rotation();
    // Pin's local up vector, world Y component: 1 − 2(qx² + qz²)
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return p.y < 0.12 || upY < 0.8 || p.z > 19.1 || Math.abs(p.x) > LANE_HALF_WIDTH;
  });

  events.free();
  world.free();

  return {
    numFrames,
    ballFrames: ballFrames.slice(0, numFrames * BALL_STRIDE),
    pinFrames: pinFrames.slice(0, numFrames * NUM_PINS * PIN_STRIDE),
    knockedPins,
    impactFrame,
    gutterFrame,
    entry,
    hits,
  };
}
