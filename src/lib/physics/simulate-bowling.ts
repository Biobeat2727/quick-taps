import RAPIER from '@dimforge/rapier3d-compat';
import {
  PIN_POSITIONS,
  LANE_HALF_WIDTH,
  BALL_RADIUS,
} from '@/lib/bowling/bowling-constants';
import type { ThrowParams, BowlingRawRecording } from '@/types/bowling';

const MAX_FRAMES = 600; // 10s @ 60 Hz
const NUM_PINS = 10;
const PIN_COMPONENTS = 7; // x,y,z, qx,qy,qz,qw

let rapierInited = false;

export async function simulateBowl(params: ThrowParams): Promise<BowlingRawRecording> {
  if (!rapierInited) {
    await RAPIER.init();
    rapierInited = true;
  }

  const { startX: rawStartX, direction, power, spin, pinState } = params;
  const speed = 2 + power * 6;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // ── Static geometry ──────────────────────────────────────────────────────

  // Lane floor — ends just past the pin deck; ball and pins fall into the pit beyond
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.01, 9.0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(LANE_HALF_WIDTH, 0.01, 9.5).setFriction(0.12).setRestitution(0.3),
      b,
    );
  }

  // Gutter floors — flat cuboid at the bottom of the visual trough (y = center - r = -0.25)
  for (const sx of [-1, 1] as const) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sx * 0.655, -0.25, 9.0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.125, 0.01, 9.5).setFriction(0.05).setRestitution(0.1),
      b,
    );
  }

  // Outer walls
  for (const sx of [-1, 1] as const) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sx * 0.78, 0.1, 9.0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.01, 0.2, 9.5).setFriction(0.1).setRestitution(0.2),
      b,
    );
  }

  // Pit catch floor — sits 1.5m below lane level, stops objects falling forever
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.5, 20.0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 0.01, 4.0).setFriction(0.8).setRestitution(0.0),
      b,
    );
  }

  // Far OOB wall — invisible safety net, never reached in normal play
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.0, 23.0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 2.0, 0.01).setFriction(0.8).setRestitution(0.0),
      b,
    );
  }

  // ── Dynamic pins ─────────────────────────────────────────────────────────

  const pinHandles: number[] = [];
  for (let i = 0; i < NUM_PINS; i++) {
    if (!pinState[i]) {
      pinHandles.push(-1);
      continue;
    }
    const [px, py, pz] = PIN_POSITIONS[i];
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setAngularDamping(1.0)
        .setLinearDamping(0.2),
    );
    // Flat base — tiny disc that contacts the lane floor, giving the pin stable
    // standing equilibrium (same role as the real 1" flat base on a bowling pin).
    // The belly capsule floats 9mm above the floor while standing; once the pin
    // is knocked over the base becomes irrelevant and the capsule ends drive rolling.
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.001, 0.025)
        .setTranslation(0, -0.190, 0)  // bottom at world y=0.000
        .setFriction(0.25)
        .setRestitution(0.10)
        .setDensity(1.0),
      b,
    );
    // Belly — wide, dense capsule; rounded ends let knocked pins roll/slide smoothly.
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.110, 0.052)
        .setTranslation(0, -0.020, 0)
        .setFriction(0.20)
        .setRestitution(0.50)
        .setDensity(2.0),
      b,
    );
    // Neck + crown — narrow, light capsule.
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.018, 0.022)
        .setTranslation(0, 0.155, 0)
        .setFriction(0.20)
        .setRestitution(0.50)
        .setDensity(0.5),
      b,
    );
    pinHandles.push(b.handle);
  }

  // ── Dynamic ball ─────────────────────────────────────────────────────────

  const startX = Math.max(-0.45, Math.min(0.45, rawStartX));
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(startX, BALL_RADIUS, 0.3),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setFriction(0.2)
      .setRestitution(0.35)
      .setDensity(3.0),
    ballBody,
  );

  // Launch — rolling velocity + Z-axis spin for hook.
  // Y-axis spin creates zero contact slip (contact lies on Y axis), so hook must come
  // from Z angular velocity which produces lateral sliding at the contact patch.
  // Positive spin = right hook (positive X drift), so angvel.z = -spin (right-hand rule).
  const rollAngvel = speed / BALL_RADIUS; // natural forward roll (positive X for +Z travel)
  ballBody.setLinvel({ x: Math.sin(direction) * speed, y: 0, z: Math.cos(direction) * speed }, true);
  ballBody.setAngvel({ x: rollAngvel, y: 0, z: spin * 5 }, true);

  // ── Record + simulate ─────────────────────────────────────────────────────

  const ballFramesList: Float32Array[] = [];
  const pinFramesList: Float32Array[] = [];

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    world.step();

    const bp = ballBody.translation();
    const ballF = new Float32Array(3);
    ballF[0] = bp.x; ballF[1] = bp.y; ballF[2] = bp.z;
    ballFramesList.push(ballF);

    const pinF = new Float32Array(NUM_PINS * PIN_COMPONENTS);
    for (let i = 0; i < NUM_PINS; i++) {
      const base = i * PIN_COMPONENTS;
      if (pinHandles[i] === -1) {
        // Knocked before this throw — store original position, flat on floor
        const [px, , pz] = PIN_POSITIONS[i];
        pinF[base]     = px;
        pinF[base + 1] = -0.191; // below floor
        pinF[base + 2] = pz;
        pinF[base + 3] = 0; pinF[base + 4] = 0; pinF[base + 5] = 0; pinF[base + 6] = 1;
      } else {
        const pb = world.getRigidBody(pinHandles[i]);
        const pp = pb.translation();
        const pq = pb.rotation();
        pinF[base]     = pp.x;
        pinF[base + 1] = pp.y;
        pinF[base + 2] = pp.z;
        pinF[base + 3] = pq.x;
        pinF[base + 4] = pq.y;
        pinF[base + 5] = pq.z;
        pinF[base + 6] = pq.w;
      }
    }
    pinFramesList.push(pinF);

    // Early stop: all bodies sleeping after at least 30 frames
    if (frame > 30 && world.bodies.getAll().every(b => b.isSleeping())) break;
  }

  // ── knockedPins ───────────────────────────────────────────────────────────

  const knockedPins: boolean[] = pinState.map((standing, i) => {
    if (!standing) return false; // already knocked before this throw
    if (pinHandles[i] === -1) return false;
    const pb = world.getRigidBody(pinHandles[i]);
    return pb.translation().y < 0.08;
  });

  // ── Pack to base64 ────────────────────────────────────────────────────────

  const numFrames = ballFramesList.length;

  const flatBall = new Float32Array(numFrames * 3);
  for (let f = 0; f < numFrames; f++) flatBall.set(ballFramesList[f], f * 3);

  const flatPins = new Float32Array(numFrames * NUM_PINS * PIN_COMPONENTS);
  for (let f = 0; f < numFrames; f++) flatPins.set(pinFramesList[f], f * NUM_PINS * PIN_COMPONENTS);

  const ballFramesBase64 = Buffer.from(flatBall.buffer).toString('base64');
  const pinFramesBase64 = Buffer.from(flatPins.buffer).toString('base64');

  return { numFrames, ballFramesBase64, pinFramesBase64, knockedPins };
}
