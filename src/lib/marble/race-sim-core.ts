// Isomorphic marble race simulation — no 'use client', no Node APIs.
// Takes the Rapier module as an argument so the server (real races) and the
// browser (/marble-lab) run the identical world.
//
// Recording: REC_HZ frames of [x, y, z, progress] per marble. Frame 0 is the
// settled grid behind the start gate; the gate drops at t = 0 (frame 0 → 1).

import type RAPIER_T from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import {
  buildTrack, frameAt, frameQuat, locate, puncherExtension, spinnerAngle, trackPoint,
  type BuiltTrack, type MarbleMapDef,
} from './track';

type Rapier = typeof RAPIER_T;

// 120 Hz without CCD: small enough steps that fast marbles don't tunnel, and
// ~6× cheaper than CCD (which also added drag on every wall contact).
export const SIM_HZ = 120;
export const REC_HZ = 30;
export const REC_STRIDE = 4;
export const MARBLE_R = 0.5;
export const GRAVITY = 30;

const MAX_SECONDS = 150;
const SETTLE_STEPS = 90;
const AFTER_FINISH_STEPS = SIM_HZ * 3; // let the last marble roll into the basin
const STUCK_STEPS = SIM_HZ * 8;

export const SPINNER_H = 0.32;    // arm half-height
export const SPINNER_T = 0.22;    // arm half-thickness
export const SPINNER_Y = 0.5;     // arm centre height above the floor
export const BUMPER_H = 0.45;     // bumper post half-height
export const GLOVE = { hx: 0.55, hy: 0.55, hz: 0.8, y: 0.6 }; // glove half-extents (lateral, up, forward), centre height

export interface RaceSimResult {
  numMarbles: number;
  numFrames: number;
  frames: Float32Array;          // numFrames × numMarbles × REC_STRIDE
  ranking: number[];             // marble indices, winner first
  finishFrame: (number | null)[];// recorded frame each marble crossed the line
  respawns: number;
  /** Debug: [progress, stuck] for each respawn. */
  respawnLog: [number, boolean, string][];
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a marble respawns after falling or getting stuck at progress s. */
function respawnS(tr: BuiltTrack, s: number, stuck: boolean) {
  for (const [g0, g1] of tr.gapRanges) {
    if (s > g0 - 14 && s < g1 + 2) return g1 + 4; // failed the jump → land them past it
  }
  return stuck ? s + 3 : Math.max(tr.gateS + 2, s - 3);
}

export function spinnerPose(tr: BuiltTrack, i: number, t: number) {
  const sp = tr.spinners[i];
  const fr = frameAt(tr, sp.s);
  const pos = trackPoint(fr, sp.offset, SPINNER_Y);
  const q = frameQuat(fr).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spinnerAngle(sp, t)));
  return { pos, q };
}

/** Glove centre: tucked just outside the wall at rest, `reach` into the track when punched. */
export function puncherPose(tr: BuiltTrack, i: number, t: number) {
  const p = tr.punchers[i];
  const fr = frameAt(tr, p.s);
  const e = puncherExtension(p, t);
  const lat = p.side * (fr.w / 2 + GLOVE.hx + 0.15 - e * p.reach);
  return { pos: trackPoint(fr, lat, GLOVE.y), q: frameQuat(fr), e, fr };
}

export function runRaceSim(RAPIER: Rapier, def: MarbleMapDef, n: number, seed: number): RaceSimResult {
  const tr = buildTrack(def);
  const rand = mulberry32(seed);

  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / SIM_HZ;

  // Trough
  const track = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(tr.positions, tr.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.12).setRestitution(0.3),
    track,
  );

  // Bumpers
  for (const b of tr.bumpers) {
    const fr = frameAt(tr, b.s);
    const p = trackPoint(fr, b.offset, BUMPER_H);
    const q = frameQuat(fr);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation(q));
    world.createCollider(
      // Thin pegs soak a little energy (pachinko pins); posts and pop-bumpers kick.
      RAPIER.ColliderDesc.cylinder(BUMPER_H, b.r).setRestitution(b.pop ? 1.4 : b.r <= 0.3 ? 0.55 : 1.2)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setFriction(0.1),
      body,
    );
  }

  // Spinners (kinematic, driven by t)
  const spinBodies = tr.spinners.map((sp, i) => {
    const { pos, q } = spinnerPose(tr, i, 0);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(q),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(sp.arm, SPINNER_H, SPINNER_T).setFriction(0.2).setRestitution(0.6), body);
    world.createCollider(RAPIER.ColliderDesc.cylinder(SPINNER_H + 0.1, 0.55).setFriction(0.2).setRestitution(0.6), body);
    return body;
  });

  // Punchers (kinematic, translation driven by t)
  const punchBodies = tr.punchers.map((_, i) => {
    const { pos, q } = puncherPose(tr, i, 0);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(q),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(GLOVE.hx, GLOVE.hy, GLOVE.hz).setFriction(0.2).setRestitution(0.1), body);
    return body;
  });

  // Start gate
  const gFr = frameAt(tr, tr.gateS);
  const gP = trackPoint(gFr, 0, gFr.wall / 2);
  const gateBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(gP.x, gP.y, gP.z).setRotation(frameQuat(gFr)),
  );
  const gate = world.createCollider(RAPIER.ColliderDesc.cuboid(gFr.w / 2, gFr.wall / 2, 0.15), gateBody);

  // Marbles: shuffled grid behind the gate
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const perRow = Math.max(1, Math.floor((gFr.w - 1) / (MARBLE_R * 2 + 0.35)));
  const bodies = order.map((slot) => {
    const row = Math.floor(slot / perRow), col = slot % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    const fr = frameAt(tr, tr.gateS - 0.9 - row * 1.3);
    const off = (col - (inRow - 1) / 2) * (MARBLE_R * 2 + 0.35) + (rand() - 0.5) * 0.2;
    const p = trackPoint(fr, off, MARBLE_R + 0.05);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z)
        .setLinearDamping(0.05).setAngularDamping(0.1),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(MARBLE_R).setFriction(0.2).setRestitution(0.4).setDensity(1),
      body,
    );
    return body;
  });

  for (let i = 0; i < SETTLE_STEPS; i++) world.step();
  world.removeCollider(gate, false);

  // Race bookkeeping
  const hint = bodies.map((b) => { const p = b.translation(); return locate(tr, p.x, p.y, p.z, -1); });
  const prog = new Float64Array(n);
  const best = new Float64Array(n);
  const bestAt = new Int32Array(n);
  const slowFor = new Int32Array(n);
  const finishStep: (number | null)[] = new Array(n).fill(null);
  let respawns = 0;
  const respawnLog: [number, boolean, string][] = [];

  const recFrames: Float32Array[] = [];
  const record = () => {
    const fd = new Float32Array(n * REC_STRIDE);
    for (let i = 0; i < n; i++) {
      const p = bodies[i].translation();
      fd.set([p.x, p.y, p.z, prog[i]], i * REC_STRIDE);
    }
    recFrames.push(fd);
  };
  const measure = (i: number) => {
    const p = bodies[i].translation();
    hint[i] = locate(tr, p.x, p.y, p.z, hint[i]);
    const fr = tr.frames[hint[i]];
    const d = new Vector3(p.x - fr.p.x, p.y - fr.p.y, p.z - fr.p.z);
    prog[i] = fr.s + d.dot(fr.t);
    return { fr, up: d.dot(fr.n), lat: d.dot(fr.side), dist: d.length() };
  };
  const respawn = (i: number, step: number, stuck: boolean) => {
    const m = measure(i);
    const v = bodies[i].linvel();
    const dbg = `lat${m.lat.toFixed(1)} up${m.up.toFixed(1)} v${Math.hypot(v.x, v.y, v.z).toFixed(1)} p${prog[i].toFixed(0)}`;
    const s = respawnS(tr, best[i], stuck);
    const fr = frameAt(tr, s);
    const p = trackPoint(fr, (rand() - 0.5) * Math.min(2, fr.w - 2), MARBLE_R + 0.3);
    bodies[i].setTranslation(p, true);
    bodies[i].setLinvel({ x: fr.t.x * 3, y: fr.t.y * 3, z: fr.t.z * 3 }, true);
    bodies[i].setAngvel({ x: 0, y: 0, z: 0 }, true);
    hint[i] = locate(tr, p.x, p.y, p.z, -1);
    bestAt[i] = step;
    respawns++;
    respawnLog.push([Math.round(best[i]), stuck, dbg]);
  };

  for (let i = 0; i < n; i++) { measure(i); best[i] = prog[i]; }
  record();

  const maxSteps = MAX_SECONDS * SIM_HZ;
  let endStep = maxSteps;
  for (let step = 1; step <= maxSteps && step <= endStep; step++) {
    const t = step / SIM_HZ;
    spinBodies.forEach((b, i) => b.setNextKinematicRotation(spinnerPose(tr, i, t).q));
    punchBodies.forEach((b, i) => b.setNextKinematicTranslation(puncherPose(tr, i, t).pos));
    world.step();

    for (let i = 0; i < n; i++) {
      const m = measure(i);
      if (finishStep[i] !== null) continue;
      // Airborne above the track is fine (jumps); only dropping below it or
      // leaving sideways under the wall tops counts as a fall.
      const fell = m.fr.gap
        ? m.up < -7
        : m.up < -3.5 || (m.up < m.fr.wall + 0.5 && Math.abs(m.lat) > m.fr.w / 2 + 3) || m.dist > 30;
      if (fell) { respawn(i, step, false); measure(i); continue; }
      // Anti-stall: a marble balanced on a peg or wedged still gets a small
      // random nudge after ¾ s — invisible, and far better than a respawn.
      const lv = bodies[i].linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) < 0.7) {
        if (++slowFor[i] > SIM_HZ * 0.75) {
          const k = (rand() - 0.5) * 2;
          bodies[i].applyImpulse({
            x: m.fr.side.x * k + m.fr.t.x * 0.6, y: m.fr.side.y * k + m.fr.t.y * 0.6 + 0.3, z: m.fr.side.z * k + m.fr.t.z * 0.6,
          }, true);
          slowFor[i] = 0;
        }
      } else slowFor[i] = 0;
      if (prog[i] > best[i] + 0.3) { best[i] = prog[i]; bestAt[i] = step; }
      else if (step - bestAt[i] > STUCK_STEPS) { respawn(i, step, true); measure(i); continue; }
      if (prog[i] >= tr.finishS) {
        finishStep[i] = step;
        if (finishStep.every((f) => f !== null)) endStep = step + AFTER_FINISH_STEPS;
      }
    }
    if (step % (SIM_HZ / REC_HZ) === 0) record();
  }

  const ranking = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const fa = finishStep[a], fb = finishStep[b];
    if (fa !== null && fb !== null) return fa - fb || a - b;
    if (fa !== null) return -1;
    if (fb !== null) return 1;
    return best[b] - best[a];
  });

  const numFrames = recFrames.length;
  const frames = new Float32Array(numFrames * n * REC_STRIDE);
  recFrames.forEach((f, i) => frames.set(f, i * n * REC_STRIDE));
  world.free();

  return {
    numMarbles: n,
    numFrames,
    frames,
    ranking,
    finishFrame: finishStep.map((f) => (f === null ? null : Math.ceil(f / (SIM_HZ / REC_HZ)))),
    respawns,
    respawnLog,
  };
}
