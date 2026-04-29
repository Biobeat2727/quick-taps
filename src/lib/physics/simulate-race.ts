/**
 * Server-side marble race simulation using Rapier (Node.js).
 *
 * Builds an exact copy of the physics world from MarbleRaceScene.tsx and
 * steps it at 60 Hz until all marbles finish (or 2-minute safety cap).
 * Returns a compact recording that clients replay — no physics runs on
 * the client, so every player sees the exact same race.
 *
 * Three.js geometry classes (TubeGeometry, CylinderGeometry) work in
 * Node.js because they are pure math with no WebGL dependency.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { CatmullRomCurve3, TubeGeometry, CylinderGeometry, Vector3 } from 'three';
import type { SessionPlayer } from '@/types/session';
import type { RaceRecording } from '@/types/race';

// ── Seeded PRNG — must match mulberry32 in MarbleRaceScene.tsx ────────────────
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Track geometry constants — must match MarbleRaceScene.tsx ─────────────────

const PEGS: [number, number, number][] = [];
for (let row = 0; row < 8; row++) {
  const z = row * 8;
  const xs = row % 2 === 0 ? [-11, -6, 0, 6, 11] : [-9, -3, 3, 9];
  for (const x of xs) PEGS.push([x, 0, z]);
}

const TUBE_PATHS: [number, number, number][][] = [
  [[-9,0,87],[-9,0,100],[-9,8,130],[0,8,155],[9,8,180],[9,4,205],[9,0,215],[9,8,222]],
  [[-3,0,87],[-3,0,100],[-3,3,130],[0,3,155],[3,3,180],[3,1,205],[3,0,215],[3,5,222]],
  [[ 3,0,87],[ 3,0,100],[ 3,-3,130],[0,-3,155],[-3,-3,180],[-3,-1,205],[-3,0,215],[-3,-5,222]],
  [[ 9,0,87],[ 9,0,100],[ 9,-8,130],[0,-8,155],[-9,-8,180],[-9,-4,205],[-9,0,215],[-9,-8,222]],
];

// ── Geometry builders ─────────────────────────────────────────────────────────
// Winding is flipped to match the client (inside faces become collision surface).

function tubeTrimesh(path: [number, number, number][]) {
  const curve = new CatmullRomCurve3(path.map(([x, y, z]) => new Vector3(x, y, z)));
  const geom = new TubeGeometry(curve, 60, 1.8, 12, false);
  const verts = new Float32Array(geom.attributes.position.array);
  const raw = new Uint32Array(geom.index!.array);
  const idx = new Uint32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    idx[i] = raw[i + 1]; idx[i + 1] = raw[i]; idx[i + 2] = raw[i + 2];
  }
  geom.dispose();
  return { verts, idx };
}

function funnelTrimesh() {
  const geom = new CylinderGeometry(2, 40, 28, 64, 1, true);
  const verts = new Float32Array(geom.attributes.position.array);
  const raw = new Uint32Array(geom.index!.array);
  const idx = new Uint32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    idx[i] = raw[i + 1]; idx[i + 1] = raw[i]; idx[i + 2] = raw[i + 2];
  }
  geom.dispose();
  return { verts, idx };
}

// ── Quaternion helper ─────────────────────────────────────────────────────────

function quatY(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

// ── Main export ───────────────────────────────────────────────────────────────

let rapierInited = false;

export async function simulateRace(
  players: SessionPlayer[],
  seed: number,
): Promise<RaceRecording> {
  if (!rapierInited) {
    await RAPIER.init();
    rapierInited = true;
  }

  const world = new RAPIER.World({ x: 0, y: 0, z: 15 });

  // ── Static geometry ──────────────────────────────────────────────────────

  // Outer walls (matches: position=[x,0,110], boxGeometry [1,4,240])
  for (const x of [-15, 15]) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, 110));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 2, 120).setFriction(0.1).setRestitution(0.5),
      b,
    );
  }

  // Pegs (matches: cylinderGeometry [0.6, 0.6, 3, 12], colliders="hull")
  for (const [x, y, z] of PEGS) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(1.5, 0.6).setRestitution(0.6).setFriction(0.1),
      b,
    );
  }

  // Channel dividers (matches: position=[cx,0,79], boxGeometry [2,4,28])
  for (const cx of [-6, 0, 6]) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 0, 79));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 2, 14).setFriction(0.1).setRestitution(0.3),
      b,
    );
  }

  // Angled chute walls (matches: position=[side*13,0,78], rotation=[0,-side*atan2(4,26),0])
  for (const side of [1, -1] as const) {
    const angle = -side * Math.atan2(4, 26);
    const halfLen = Math.sqrt(4 * 4 + 26 * 26) / 2;
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(side * 13, 0, 78).setRotation(quatY(angle)),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 2, halfLen).setFriction(0.1).setRestitution(0.3),
      b,
    );
  }

  // FIX_INTERNAL_EDGES smooths collision response at triangle seams so marbles
  // don't snag on the boundary between adjacent triangles and slow to a crawl.
  const trimeshFlags = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES;

  // Glass tubes — trimesh colliders (matches GlassTube component)
  for (const path of TUBE_PATHS) {
    const { verts, idx } = tubeTrimesh(path);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, idx, trimeshFlags).setFriction(0.4).setRestitution(0.3),
      b,
    );
  }

  // Funnel (matches: position=[0,0,244], rotation=[PI/2,0,0])
  // CylinderGeometry(radiusTop=2, radiusBottom=40, height=28) along Y,
  // rotated PI/2 around X → cylinder axis along Z, tip at z=258, mouth at z=230.
  {
    const { verts, idx } = funnelTrimesh();
    // Apply the same rotation+translation as the client by transforming verts
    // rather than using a body rotation, to avoid Rapier trimesh transform bugs.
    // Rotation PI/2 around X: (x,y,z) → (x, -z, y)  then translate z+244.
    const tv = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      tv[i]     = verts[i];
      tv[i + 1] = -verts[i + 2];
      tv[i + 2] = verts[i + 1] + 244;
    }
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(tv, idx, trimeshFlags).setFriction(0.04).setRestitution(0.4),
      b,
    );
  }

  // Catch floor (matches: position=[0,0,263], boxGeometry [30,4,1])
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 263));
    world.createCollider(RAPIER.ColliderDesc.cuboid(15, 2, 0.5), b);
  }

  // ── Marbles ──────────────────────────────────────────────────────────────

  const n = players.length;
  const randPos = mulberry32(seed);
  const randImp = mulberry32(seed + 1);

  const starts: [number, number, number][] = players.map((_, i) => [
    -10 + (i / Math.max(n - 1, 1)) * 20 + (randPos() * 3 - 1.5),
    0,
    -10,
  ]);
  const impulses = players.map(() => randImp() * 6 - 3);

  const bodies: RAPIER.RigidBody[] = starts.map(([x, y, z]) => {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(1).setRestitution(0.5).setFriction(0.4),
      b,
    );
    return b;
  });

  // ── Run simulation ────────────────────────────────────────────────────────

  const MAX_FRAMES = 7200; // 2-minute safety cap at 60 Hz
  const allFrames: Float32Array[] = [];

  // Frame 0: initial positions (pre-impulse) so the client can show marbles
  // at rest during the countdown.
  {
    const f0 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = bodies[i].translation();
      f0[i * 3] = p.x; f0[i * 3 + 1] = p.y; f0[i * 3 + 2] = p.z;
    }
    allFrames.push(f0);
  }

  // Apply launch impulses (matches: GameLoop applies on first racing frame)
  for (let i = 0; i < n; i++) {
    bodies[i].applyImpulse({ x: impulses[i], y: 0, z: 0 }, true);
  }

  const finished = new Set<number>();
  const enteredFunnel = new Set<number>();
  const ranking: string[] = [];

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    world.step();

    const fd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = bodies[i].translation();
      fd[i * 3] = p.x; fd[i * 3 + 1] = p.y; fd[i * 3 + 2] = p.z;

      if (!finished.has(i)) {
        if (p.z >= 225) enteredFunnel.add(i);
        if (p.z >= 258) {
          finished.add(i);
          ranking.push(players[i].id);
        } else if (
          // Funnel escape: entered then bounced back out
          (enteredFunnel.has(i) && (p.z < 218 || Math.abs(p.x) > 50 || Math.abs(p.y) > 50)) ||
          // General out-of-bounds anywhere on the track (e.g. phased through a tube wall)
          Math.abs(p.x) > 60 || Math.abs(p.y) > 60 || p.z > 270
        ) {
          finished.add(i);
          ranking.push(players[i].id);
        }
      }
    }
    allFrames.push(fd);

    if (finished.size >= n) break;
  }

  // Pack all frames into a single Float32Array and base64-encode for Redis.
  const numFrames = allFrames.length;
  const flat = new Float32Array(numFrames * n * 3);
  for (let f = 0; f < numFrames; f++) flat.set(allFrames[f], f * n * 3);
  const framesBase64 = Buffer.from(flat.buffer).toString('base64');

  return { numMarbles: n, numFrames, framesBase64, ranking };
}
