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
}

export interface BowlSimResult {
  numFrames: number;
  ballFrames: Float32Array; // numFrames × BALL_STRIDE
  pinFrames: Float32Array;  // numFrames × NUM_PINS × PIN_STRIDE
  knockedPins: boolean[];   // newly knocked this throw
  impactFrame: number;      // first frame a pin moves (−1 = none)
  gutterFrame: number;      // first frame the ball drops into a gutter (−1 = none)
}

// Oil pattern: the ball skids straight through the oiled heads, the hook
// "reads" the dry backend and ramps in, then flattens once the ball reaches the deck.
const HOOK_START = 8.5;
const HOOK_FULL = 13.5;

/** Physics tuning knobs — exported so offline calibration scripts can sweep them. */
export const TUNING = {
  hookAccel: 1.35,      // m/s² lateral at spin = 1 on the dry backend
  ballDensity: 4.5,     // ball:pin mass ≈ 4.8:1, close to a 15 lb ball vs 3.5 lb pin
  pinRestitution: 0.5,
  pinFriction: 0.2,
  pinLinDamp: 0.15,
  pinAngDamp: 0.8,
  pinBellyR: 0.0605,    // collider radius = a real pin's belly
  carry: 0.7,           // 0..1 — pocket-hit deflection assist; 0.7 ≈ 60–70% strikes on pocket hits
};

export function runBowlSim(RAPIER: Rapier, t: BowlThrow): BowlSimResult {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / SIM_HZ;

  const fixed = (x: number, y: number, z: number) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));

  // Lane — ends just past the deck; ball and pins drop into the pit beyond.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(LANE_HALF_WIDTH, 0.01, 9.5).setFriction(0.12).setRestitution(0.3),
    fixed(0, -0.01, 9.0),
  );
  for (const sx of [-1, 1]) {
    // Gutter floor at the bottom of the visual trough
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.125, 0.01, 9.5).setFriction(0.05).setRestitution(0.1),
      fixed(sx * 0.655, -0.25, 9.0),
    );
    // Outer wall / kickback
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.01, 0.35, 10).setFriction(0.1).setRestitution(0.35),
      fixed(sx * 0.78, 0.1, 9.5),
    );
  }
  // Pit floor + back cushion
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2.0, 0.01, 2.5).setFriction(0.8).setRestitution(0.0),
    fixed(0, -0.6, 20.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2.0, 1.0, 0.05).setFriction(0.8).setRestitution(0.05),
    fixed(0, 0.2, 21.2),
  );

  // Pins — 3-collider compound (flat base for stable standing, belly + neck capsules).
  // See docs/BOWLING.md "Pin Physics" for why this shape.
  const pins: (RAPIER_T.RigidBody | null)[] = [];
  for (let i = 0; i < NUM_PINS; i++) {
    if (!t.pinState[i]) { pins.push(null); continue; }
    const [px, py, pz] = PIN_POSITIONS[i];
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz).setAngularDamping(TUNING.pinAngDamp).setLinearDamping(TUNING.pinLinDamp),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.001, 0.025).setTranslation(0, -0.19, 0)
        .setFriction(0.25).setRestitution(0.1).setDensity(1.0), b);
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.11, TUNING.pinBellyR).setTranslation(0, -0.02, 0)
        .setFriction(TUNING.pinFriction).setRestitution(TUNING.pinRestitution).setDensity(2.0), b);
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.018, 0.022).setTranslation(0, 0.155, 0)
        .setFriction(TUNING.pinFriction).setRestitution(TUNING.pinRestitution).setDensity(0.5), b);
    pins.push(b);
  }

  // Ball
  const startX = Math.max(-0.45, Math.min(0.45, t.startX));
  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(startX, BALL_RADIUS, 0.3).setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setFriction(0.2).setRestitution(0.35).setDensity(TUNING.ballDensity),
    ball,
  );
  const speed = Math.max(2, Math.min(10, t.speed));
  ball.setLinvel({ x: Math.sin(t.direction) * speed, y: 0, z: Math.cos(t.direction) * speed }, true);
  ball.setAngvel({ x: speed / BALL_RADIUS, y: 0, z: 0 }, true);
  const ballMass = ball.mass();

  const ballFrames = new Float32Array(MAX_FRAMES * BALL_STRIDE);
  const pinFrames = new Float32Array(MAX_FRAMES * NUM_PINS * PIN_STRIDE);
  let impactFrame = -1;
  const boosted = new Array(NUM_PINS).fill(false);
  let pocketQ = -1, impactBallX = 0;
  let gutterFrame = -1;
  let numFrames = 0;
  const dt = 1 / SIM_HZ;

  for (let f = 0; f < MAX_FRAMES; f++) {
    const bp = ball.translation();

    // Hook — lateral push on the dry backend while the ball is still rolling on the lane.
    if (gutterFrame < 0 && bp.y > 0.05 && bp.z < 17.2 && Math.abs(bp.x) < LANE_HALF_WIDTH) {
      const u = Math.min(1, Math.max(0, (bp.z - HOOK_START) / (HOOK_FULL - HOOK_START)));
      const ramp = u * u * (3 - 2 * u);
      if (ramp > 0) ball.applyImpulse({ x: t.spin * TUNING.hookAccel * ramp * ballMass * dt, y: 0, z: 0 }, true);
    }

    world.step();

    // Carry: rigid capsules get shoved straight back, but real pins deflect sideways
    // off the ball's path and cascade across the deck (head pin → 3 → 6 → 10). On a
    // pocket hit, the first time each pin starts moving, guarantee it a share of
    // lateral motion away from the ball's line. Scaled by pocket quality, so an
    // off-target ball earns nothing.
    if (TUNING.carry > 0 && impactFrame >= 0) {
      if (pocketQ < 0) {
        const bx = ball.translation().x;
        const ax = Math.abs(bx);
        pocketQ = ax >= 0.025 && ax <= 0.115 ? 1 : ax < 0.025 ? ax / 0.025 : Math.max(0, 1 - (ax - 0.115) / 0.1);
        impactBallX = bx;
      }
      const minLat = TUNING.carry * pocketQ;
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
        const [px, , pz] = PIN_POSITIONS[i];
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

  world.free();

  return {
    numFrames,
    ballFrames: ballFrames.slice(0, numFrames * BALL_STRIDE),
    pinFrames: pinFrames.slice(0, numFrames * NUM_PINS * PIN_STRIDE),
    knockedPins,
    impactFrame,
    gutterFrame,
  };
}
