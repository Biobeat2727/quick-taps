'use client';

// The table as real geometry: rails and felt are extruded outlines with the
// pocket holes actually cut out, cushions are shaped to end on the pocket jaws,
// and each pocket is a cup — so nothing overlaps or z-fights at the pockets.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L, CORNER_MOUTH as CM, SIDE_MOUTH as SM, POCKETS,
} from '@/lib/pool/pool-sim-core';
import { feltTexture } from './poolTextures';

export const RAIL_IN = 0.035;   // cushion depth (nose → rail wood)
export const RAIL_W = 0.085;    // wooden rail width
export const RAIL_TOP = 0.045;
const CUSHION_TOP = 0.04;       // ~63% of ball height, like a real K66 nose
const XI = W + RAIL_IN, ZI = L + RAIL_IN;           // inner edge of the rail wood
export const OUTER_W = XI + RAIL_W, OUTER_L = ZI + RAIL_W;
export const POCKET_R = [0.069, 0.069, 0.065, 0.065, 0.069, 0.069];

type P = [number, number]; // world (x, z)

/**
 * Outline of the rail's inner edge, walked counter-clockwise, detouring around
 * each pocket. `outward` = true bulges around the pocket (rail wood's hole);
 * false cuts in (the felt's edge).
 */
function innerOutline(outward: boolean): P[] {
  const pts: P[] = [];
  const arc = (c: P, r: number, from: P, to: P) => {
    const a1 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    let a2 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    if (outward) { while (a2 < a1) a2 += Math.PI * 2; } else { while (a2 > a1) a2 -= Math.PI * 2; }
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = a1 + ((a2 - a1) * i) / n;
      pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
  };
  // circle ∩ vertical line x = X  → z values;  circle ∩ horizontal z = Z → x values
  const onX = (c: P, r: number, X: number) => Math.sqrt(Math.max(0, r * r - (X - c[0]) ** 2));
  const onZ = (c: P, r: number, Z: number) => Math.sqrt(Math.max(0, r * r - (Z - c[1]) ** 2));
  const [fl, fr, ml, mr, nl, nr] = POCKETS as unknown as P[];
  const [rfl, rfr, rml, rmr, rnl, rnr] = POCKET_R;

  // right edge (x = XI) going +z: near-right corner → side → far-right corner
  arc(nr, rnr, [nr[0] - onZ(nr, rnr, -ZI), -ZI], [XI, nr[1] + onX(nr, rnr, XI)]);
  arc(mr, rmr, [XI, -onX(mr, rmr, XI)], [XI, onX(mr, rmr, XI)]);
  arc(fr, rfr, [XI, fr[1] - onX(fr, rfr, XI)], [fr[0] - onZ(fr, rfr, ZI), ZI]);
  // top edge (z = ZI) going −x
  arc(fl, rfl, [fl[0] + onZ(fl, rfl, ZI), ZI], [-XI, fl[1] - onX(fl, rfl, -XI)]);
  // left edge going −z
  arc(ml, rml, [-XI, onX(ml, rml, -XI)], [-XI, -onX(ml, rml, -XI)]);
  arc(nl, rnl, [-XI, nl[1] + onX(nl, rnl, -XI)], [nl[0] + onZ(nl, rnl, -ZI), -ZI]);
  return pts;
}

/** Flat outline → horizontal slab (world x,z) from y=0 up to `height`. */
function slab(outer: P[], holes: P[][], height: number, bevel = 0) {
  // Shape lives in XY; after rotateX(−π/2), shape y becomes world −z, so feed −z.
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Cushion blocks: nose segment + the two jaw cuts back to the rail wood. */
function cushionPolys(): { poly: P[]; side: number }[] {
  const out: { poly: P[]; side: number }[] = [];
  const d = RAIL_IN;
  for (const sx of [1, -1]) {
    const x = sx * W, xb = sx * XI, side = sx > 0 ? 0 : 1;
    for (const sz of [1, -1]) {
      // from the side pocket knuckle out to the corner knuckle
      const zs = sz * SM, zc = sz * (L - CM);
      out.push({ side, poly: [[x, zs], [x, zc], [xb, zc + sz * d], [xb, zs + sz * d * 0.35]] });
    }
  }
  for (const sz of [1, -1]) {
    const z = sz * L, zb = sz * ZI, side = sz > 0 ? 2 : 3;
    out.push({ side, poly: [[-(W - CM), z], [W - CM, z], [W - CM + d, zb], [-(W - CM + d), zb]] });
  }
  return out;
}

export function TableMesh({ railMats }: { railMats: THREE.MeshBasicMaterial[] }) {
  const felt = useMemo(() => feltTexture(), []);
  const geo = useMemo(() => {
    const outer: P[] = [[-OUTER_W, -OUTER_L], [OUTER_W, -OUTER_L], [OUTER_W, OUTER_L], [-OUTER_W, OUTER_L]];
    const rail = slab(outer, [innerOutline(true)], RAIL_TOP - 0.004, 0.004);
    const cloth = new THREE.ShapeGeometry(new THREE.Shape(innerOutline(false).map(([x, z]) => new THREE.Vector2(x, -z))), 6);
    cloth.rotateX(-Math.PI / 2);
    // UVs across the playing surface so the felt texture (and head string) line up
    const pos = cloth.attributes.position, uv = cloth.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + XI) / (2 * XI), 1 - (pos.getZ(i) + ZI) / (2 * ZI));
    uv.needsUpdate = true;
    const cushions = cushionPolys().map(({ poly, side }) => {
      // CCW for the extruder regardless of which side it came from
      const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
      return { g: slab(area > 0 ? poly : [...poly].reverse(), [], CUSHION_TOP), side, nose: poly.slice(0, 2) as [P, P] };
    });
    return { rail, cloth, cushions };
  }, []);
  useEffect(() => () => {
    felt.dispose(); geo.rail.dispose(); geo.cloth.dispose(); geo.cushions.forEach((c) => c.g.dispose());
  }, [felt, geo]);

  const glow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);

  const diamonds = useMemo(() => {
    const d: P[] = [];
    const lx = XI + RAIL_W / 2, lz = ZI + RAIL_W / 2;
    for (const f of [0.25, 0.5, 0.75]) for (const s of [-1, 1]) d.push([-lx, s * L * f], [lx, s * L * f]);
    for (const x of [-W / 2, 0, W / 2]) d.push([x, -lz], [x, lz]);
    return d;
  }, []);

  return (
    <group>
      <color attach="background" args={['#06040b']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#0a0712" roughness={0.9} />
      </mesh>
      {/* neon underglow halo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.59, 0]}>
        <planeGeometry args={[OUTER_W * 2 + 1.4, OUTER_L * 2 + 1.4]} />
        <meshBasicMaterial map={glow} color={new THREE.Color(0.9, 0.2, 0.8)} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      <mesh geometry={geo.cloth}>
        <meshStandardMaterial map={felt} roughness={0.95} />
      </mesh>
      {geo.cushions.map((c, i) => (
        <mesh key={i} geometry={c.g}>
          <meshStandardMaterial color="#0d4452" roughness={0.9} />
        </mesh>
      ))}
      {/* neon along each cushion's top nose edge — flashes on hits */}
      {geo.cushions.map((c, i) => {
        const [[x0, z0], [x1, z1]] = c.nose;
        return (
          <mesh key={`n${i}`} position={[(x0 + x1) / 2, CUSHION_TOP + 0.0006, (z0 + z1) / 2]}
            rotation={[0, Math.atan2(x1 - x0, z1 - z0), 0]} material={railMats[c.side]}>
            <boxGeometry args={[0.004, 0.001, Math.hypot(x1 - x0, z1 - z0)]} />
          </mesh>
        );
      })}
      <mesh geometry={geo.rail}>
        <meshBasicMaterial color="#0e0a15" />
      </mesh>
      {diamonds.map(([x, z], i) => (
        <mesh key={i} position={[x, RAIL_TOP + 0.001, z]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[0.014, 0.014]} />
          <meshBasicMaterial color={new THREE.Color(1.1, 1.0, 0.85)} toneMapped={false} />
        </mesh>
      ))}
      {/* pocket cups */}
      {POCKETS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, RAIL_TOP / 2 - 0.05, 0]}>
            <cylinderGeometry args={[POCKET_R[i], POCKET_R[i] * 0.85, RAIL_TOP + 0.1, 32, 1, true]} />
            <meshBasicMaterial color="#040208" side={THREE.BackSide} />
          </mesh>
          <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[POCKET_R[i], 32]} />
            <meshBasicMaterial color="#010002" />
          </mesh>
          {/* leather liner lip */}
          <mesh position={[0, RAIL_TOP + 0.0008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[POCKET_R[i], POCKET_R[i] + 0.005, 40]} />
            <meshBasicMaterial color="#2a1c33" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
