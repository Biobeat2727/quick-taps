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

// Subset of pegs that act as pinball bumpers (high restitution)
const BUMPER_COORDS: [number, number][] = [
  [-6, 16], [6, 16], [9, 24], [0, 32], [-9, 40], [3, 40],
];
function isBumper(x: number, z: number) {
  return BUMPER_COORDS.some(([bx, bz]) => bx === x && bz === z);
}

// Each tube has a unique Y depth lane (≈+10, +4, -4, -10) so paths never
// physically intersect even when crossing on screen (adjacent lanes ≥6 units apart).
// Each tube has its own asymmetric shape — no mirroring.
const TUBE_PATHS: [number, number, number][][] = [
  // Tube 1: y≈+10 — sweeps right early, reverses hard back left mid-track, wanders to exit
  [[-9,0,87],[-9,0,100],[-9,10,115],[8,10,128],[11,10,140],[5,10,153],[-8,10,163],[-11,10,175],[-4,10,188],[6,10,200],[9,5,208],[9,0,215],[9,8,222]],
  // Tube 2: y≈+4  — dips left first, then flicks hard right, lazy hook back to exit
  [[-3,0,87],[-3,0,100],[-3,4,115],[-10,4,125],[2,4,138],[12,4,148],[7,4,162],[-5,4,177],[4,4,193],[-8,4,205],[3,3,210],[3,0,215],[3,5,222]],
  // Tube 3: y≈-4  — tight crinkle: many small direction reversals
  [[3,0,87],[3,0,100],[3,-4,115],[10,-4,127],[-9,-4,142],[5,-4,157],[-11,-4,172],[4,-4,188],[-5,-4,205],[-3,-3,210],[-3,0,215],[-3,-5,222]],
  // Tube 4: y≈-10 — stays near entry side, then sharp unexpected dart left, slow drift to exit
  [[9,0,87],[9,0,100],[9,-10,115],[9,-10,130],[6,-10,143],[-3,-10,155],[-12,-10,165],[-8,-10,178],[3,-10,192],[-2,-10,206],[-9,-5,210],[-9,0,215],[-9,-8,222]],
];

// ── Geometry builders ─────────────────────────────────────────────────────────
// Winding is flipped to match the client (inside faces become collision surface).

function tubeTrimesh(path: [number, number, number][]) {
  const curve = new CatmullRomCurve3(path.map(([x, y, z]) => new Vector3(x, y, z)));
  const geom = new TubeGeometry(curve, 80, 1.8, 12, false);
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
  const geom = new CylinderGeometry(2, 20, 28, 64, 1, true);
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

  // Back wall — seals the entry of Act 1 so bumper-launched marbles can't escape backward.
  // Matches the visual mesh added to MarbleRaceScene.tsx at the same position.
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -13));
    world.createCollider(RAPIER.ColliderDesc.cuboid(16, 3, 0.5).setFriction(0.1).setRestitution(0.5), b);
  }

  // Outer walls (matches: position=[x,0,110], boxGeometry [1,4,240])
  for (const x of [-15, 15]) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, 110));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 2, 120).setFriction(0.1).setRestitution(0.5),
      b,
    );
  }

  // Pegs — bumper pegs get high restitution to act as pinball bumpers
  for (const [x, y, z] of PEGS) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const bumper = isBumper(x, z);
    const desc = RAPIER.ColliderDesc.cylinder(1.5, 0.6).setFriction(0.05);
    if (bumper) {
      desc.setRestitution(2.2)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    } else {
      desc.setRestitution(0.6);
    }
    world.createCollider(desc, b);
  }

  // Ceiling and floor over peg grid — keeps marbles from flying out of the z-plane
  // when they hit a bumper. Spans z=-10 to 68 (full peg region + margins).
  for (const y of [2.5, -2.5]) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 29));
    world.createCollider(RAPIER.ColliderDesc.cuboid(15, 0.1, 39).setFriction(0).setRestitution(0.2), b);
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
      RAPIER.ColliderDesc.trimesh(tv, idx, trimeshFlags).setFriction(0.01).setRestitution(0.4),
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

  const MAX_FRAMES = 3600; // 1-minute safety cap at 60 Hz
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

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    world.step();

    // Drain orbital energy for marbles inside the funnel: apply a small radial
    // impulse toward the funnel axis each step. Too weak to noticeably alter a
    // normal straight-through transit, but strong enough to spiral out an orbiting marble.
    for (let i = 0; i < n; i++) {
      if (!finished.has(i) && enteredFunnel.has(i)) {
        const p = bodies[i].translation();
        const r = Math.sqrt(p.x * p.x + p.y * p.y);
        if (r > 1) {
          bodies[i].applyImpulse({ x: -p.x / r * 0.06, y: -p.y / r * 0.06, z: 0 }, true);
        }
      }
    }

    const fd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = bodies[i].translation();
      fd[i * 3] = p.x; fd[i * 3 + 1] = p.y; fd[i * 3 + 2] = p.z;

      if (!finished.has(i)) {
        if (p.z >= 225) enteredFunnel.add(i);
        if (
          p.z >= 258 ||
          // Funnel escape: entered then bounced back out
          (enteredFunnel.has(i) && (p.z < 218 || Math.abs(p.x) > 50 || Math.abs(p.y) > 50)) ||
          // General out-of-bounds anywhere on the track (e.g. phased through a tube wall)
          Math.abs(p.x) > 60 || Math.abs(p.y) > 60 || p.z > 270
        ) {
          finished.add(i);
        }
      }
    }
    allFrames.push(fd);

    if (finished.size >= n) break;
  }

  // Derive ranking from the recorded frames: find the first frame where each
  // marble's z >= 258 (the funnel tip). This ensures the ranking exactly matches
  // the visual exit order the client sees during replay.
  // Marbles that never reach z=258 (escaped, stuck) are ranked last by how deep
  // they got into the funnel (highest max-z = closest to finish).
  const exitFrame: (number | null)[] = new Array(n).fill(null);
  for (let f = 1; f < allFrames.length; f++) {
    const fd = allFrames[f];
    for (let i = 0; i < n; i++) {
      if (exitFrame[i] === null && fd[i * 3 + 2] >= 258) {
        exitFrame[i] = f;
      }
    }
  }

  const maxZ: number[] = new Array(n).fill(-Infinity);
  for (let f = 0; f < allFrames.length; f++) {
    const fd = allFrames[f];
    for (let i = 0; i < n; i++) {
      if (exitFrame[i] === null) maxZ[i] = Math.max(maxZ[i], fd[i * 3 + 2]);
    }
  }

  const ranking = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => {
      const fa = exitFrame[a];
      const fb = exitFrame[b];
      if (fa !== null && fb !== null) return fa - fb || a - b;
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return maxZ[b] - maxZ[a] || a - b;
    })
    .map(i => players[i].id);

  // Pack all frames into a single Float32Array and base64-encode for Redis.
  const numFrames = allFrames.length;
  const flat = new Float32Array(numFrames * n * 3);
  for (let f = 0; f < numFrames; f++) flat.set(allFrames[f], f * n * 3);
  const framesBase64 = Buffer.from(flat.buffer).toString('base64');

  return { numMarbles: n, numFrames, framesBase64, ranking };
}
