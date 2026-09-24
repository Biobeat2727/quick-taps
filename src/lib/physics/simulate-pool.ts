import RAPIER from '@dimforge/rapier3d-compat';
import {
  TABLE_HALF_LENGTH,
  TABLE_HALF_WIDTH,
  BALL_RADIUS,
  POCKET_RADIUS,
  POCKET_POSITIONS,
  BALL_START_POSITIONS,
  MAX_FRAMES,
  NUM_BALLS,
} from '@/lib/pool/pool-constants';
import type { PoolShotParams, PoolRawRecording } from '@/types/pool';

const MIN_SPEED = 1.0;
const MAX_SPEED = 8.0;

let rapierInited = false;

export async function simulatePool(params: PoolShotParams): Promise<PoolRawRecording> {
  if (!rapierInited) {
    await RAPIER.init();
    rapierInited = true;
  }

  const { angle, power, cueBallX, cueBallZ, activeBalls } = params;
  const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // ── Table floor ──────────────────────────────────────────────────────────
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.005, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(TABLE_HALF_WIDTH, 0.005, TABLE_HALF_LENGTH)
        .setFriction(0.07)
        .setRestitution(0.0),
      b,
    );
  }

  // ── Rail walls (4) ───────────────────────────────────────────────────────
  // Near/far rails
  for (const sz of [-1, 1] as const) {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.04, sz * (TABLE_HALF_LENGTH + 0.005)),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(TABLE_HALF_WIDTH, 0.04, 0.005)
        .setFriction(0.5)
        .setRestitution(0.7),
      b,
    );
  }
  // Left/right rails
  for (const sx of [-1, 1] as const) {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(sx * (TABLE_HALF_WIDTH + 0.005), 0.04, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.005, 0.04, TABLE_HALF_LENGTH)
        .setFriction(0.5)
        .setRestitution(0.7),
      b,
    );
  }

  // ── Spawn balls ──────────────────────────────────────────────────────────
  // ballHandles[i] = RigidBody handle, or -1 if not active
  const ballHandles: number[] = [];

  for (let i = 0; i < NUM_BALLS; i++) {
    if (!activeBalls[i]) {
      ballHandles.push(-1);
      continue;
    }

    let [bx, by, bz] = BALL_START_POSITIONS[i];
    // Cue ball uses the current position from params
    if (i === 0) {
      bx = cueBallX;
      by = BALL_RADIUS;
      bz = cueBallZ;
    }

    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bx, by, bz)
        .setLinearDamping(0.6)
        .setAngularDamping(5.0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setFriction(0.05)
        .setRestitution(0.92)
        .setDensity(2.0),
      b,
    );
    ballHandles.push(b.handle);
  }

  // ── Launch cue ball ──────────────────────────────────────────────────────
  if (ballHandles[0] !== -1) {
    const cueBall = world.getRigidBody(ballHandles[0]);
    cueBall.setLinvel(
      { x: Math.sin(angle) * speed, y: 0, z: Math.cos(angle) * speed },
      true,
    );
  }

  // ── Simulate ─────────────────────────────────────────────────────────────
  const pocketedAtFrame: number[] = Array(NUM_BALLS).fill(-1);
  const activeBallSet = new Set<number>(); // indices of still-active balls
  for (let i = 0; i < NUM_BALLS; i++) {
    if (ballHandles[i] !== -1) activeBallSet.add(i);
  }

  const frameData: Float32Array[] = [];
  let settledFrames = 0;

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    world.step();

    // Pocket detection — positional, post-step
    for (const i of activeBallSet) {
      const body = world.getRigidBody(ballHandles[i]);
      const pos = body.translation();
      for (const [px, pz] of POCKET_POSITIONS) {
        const dx = pos.x - px;
        const dz = pos.z - pz;
        if (Math.sqrt(dx * dx + dz * dz) <= POCKET_RADIUS) {
          pocketedAtFrame[i] = frame;
          world.removeRigidBody(body);
          activeBallSet.delete(i);
          break;
        }
      }
    }

    // Record XZ for all balls
    const f = new Float32Array(NUM_BALLS * 2);
    for (let i = 0; i < NUM_BALLS; i++) {
      if (ballHandles[i] === -1 || pocketedAtFrame[i] !== -1) {
        // Not in world — leave as 0,0 (will be hidden by pocketedAtFrame)
        f[i * 2]     = 0;
        f[i * 2 + 1] = 0;
      } else {
        const pos = world.getRigidBody(ballHandles[i]).translation();
        f[i * 2]     = pos.x;
        f[i * 2 + 1] = pos.z;
      }
    }
    frameData.push(f);

    // Stopping condition: all active balls settled for 30+ consecutive frames
    if (activeBallSet.size === 0) break;
    const allSleeping = [...activeBallSet].every(i =>
      world.getRigidBody(ballHandles[i]).isSleeping(),
    );
    if (allSleeping) {
      settledFrames++;
      if (settledFrames >= 30) break;
    } else {
      settledFrames = 0;
    }
  }

  // ── Pack recording ───────────────────────────────────────────────────────
  const numFrames = frameData.length;
  const flat = new Float32Array(numFrames * NUM_BALLS * 2);
  for (let f = 0; f < numFrames; f++) {
    flat.set(frameData[f], f * NUM_BALLS * 2);
  }

  const ballFramesBase64 = Buffer.from(flat.buffer).toString('base64');

  const cueBallPocketed = pocketedAtFrame[0] !== -1;
  const finalPocketed: boolean[] = Array(NUM_BALLS).fill(false);
  for (let i = 0; i < NUM_BALLS; i++) {
    if (activeBalls[i] && pocketedAtFrame[i] !== -1) {
      finalPocketed[i] = true;
    }
  }

  return {
    numFrames,
    numBalls: NUM_BALLS,
    ballFramesBase64,
    pocketedAtFrame,
    cueBallPocketed,
    finalPocketed,
  };
}
