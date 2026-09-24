'use client';

// Shared, lazily-built GPU assets. Module singletons: the lab mounts one
// Canvas at a time, and pins/ball are reused across remounts.

import * as THREE from 'three';
import { BALL_RADIUS } from '@/lib/bowling/bowling-constants';
import { makePinTextures, makeBallTextures } from './textures';

const PIN_Y0 = -0.191, PIN_Y1 = 0.191;

// Visual pin silhouette — [radius, y] from base to crown, USBC proportions
// (15" tall, 4.77" belly at 4.5", 1.80" neck at 10", 2.55" head at 13.5").
// Rendering-only: the physics compound in bowl-sim-core is unchanged.
const PIN_SHAPE: [number, number][] = [
  [0.0258, -0.191], [0.0300, -0.183], [0.0400, -0.161], [0.0520, -0.126],
  [0.0595, -0.092], [0.0605, -0.077], [0.0588, -0.050], [0.0520, -0.015],
  [0.0400, 0.020], [0.0292, 0.047], [0.0232, 0.064], [0.0240, 0.086],
  [0.0288, 0.116], [0.0323, 0.148], [0.0308, 0.166], [0.0250, 0.180],
  [0.0140, 0.1885], [0.0000, 0.191],
];

let _pin: { geo: THREE.LatheGeometry; yToV: (y: number) => number } | null = null;
/**
 * One continuous centripetal Catmull-Rom curve through the silhouette, sampled
 * evenly by arc length, then smoothed — no flats or ridges between control points.
 */
function buildPin() {
  if (_pin) return _pin;
  const curve = new THREE.CatmullRomCurve3(
    PIN_SHAPE.map(([r, y]) => new THREE.Vector3(r, y, 0)),
    false, 'centripetal',
  );
  const spaced = curve.getSpacedPoints(120).map((v) => new THREE.Vector2(v.x, v.y));
  // Catmull-Rom alone leaves faint ripples between control points (visible as
  // rings under glossy light). A few binomial smoothing passes, with the base and
  // crown ends pinned, leave exactly three inflections: belly→neck→head→crown.
  const n = spaced.length;
  for (let it = 0; it < 4; it++) {
    const q = spaced.map((v) => v.clone());
    for (let i = 2; i < n - 3; i++) {
      q[i].x = (spaced[i - 2].x + 4 * spaced[i - 1].x + 6 * spaced[i].x + 4 * spaced[i + 1].x + spaced[i + 2].x) / 16;
      q[i].y = (spaced[i - 2].y + 4 * spaced[i - 1].y + 6 * spaced[i].y + 4 * spaced[i + 1].y + spaced[i + 2].y) / 16;
    }
    for (let i = 2; i < n - 3; i++) spaced[i].copy(q[i]);
  }
  // Base: flat disc into the centre, then the curve up to the crown
  const pts = [new THREE.Vector2(0, PIN_Y0), ...spaced.map((p) => new THREE.Vector2(Math.max(0, p.x), p.y))];
  const geo = new THREE.LatheGeometry(pts, 48);
  // Lathe v = point index / (count − 1); map a height to that v for the stripes.
  const yToV = (y: number) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y >= y) {
        const t = (y - pts[i - 1].y) / (pts[i].y - pts[i - 1].y || 1);
        return (i - 1 + t) / (pts.length - 1);
      }
    }
    return 1;
  };
  _pin = { geo, yToV };
  return _pin;
}

export function pinGeometry() {
  return buildPin().geo;
}

let _pinMats: { body: THREE.MeshPhysicalMaterial } | null = null;
export function pinMaterials() {
  if (_pinMats) return _pinMats;
  const { yToV } = buildPin();
  const { map, emissiveMap } = makePinTextures([
    [yToV(0.040), yToV(0.050)],
    [yToV(0.074), yToV(0.084)],
  ]);
  _pinMats = {
    body: new THREE.MeshPhysicalMaterial({
      map, emissiveMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 1.6,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
  };
  return _pinMats;
}

let _ball: { geo: THREE.SphereGeometry; mat: THREE.MeshPhysicalMaterial } | null = null;
export function ballAssets() {
  if (_ball) return _ball;
  const { map, emissiveMap } = makeBallTextures();
  _ball = {
    geo: new THREE.SphereGeometry(BALL_RADIUS, 64, 48),
    mat: new THREE.MeshPhysicalMaterial({
      map, emissiveMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 2.5,
      roughness: 0.22,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      iridescence: 0.35,
    }),
  };
  return _ball;
}

let _shadowTex: THREE.Texture | null = null;
/** Soft radial blob for cheap contact shadows under ball and pins. */
export function blobShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
