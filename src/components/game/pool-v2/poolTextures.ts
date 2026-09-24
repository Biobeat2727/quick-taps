'use client';

// Procedural pool textures — no image assets.

import * as THREE from 'three';

// Saturated, bar-light-friendly ball colours (index = ball number; 9–15 reuse 1–7).
export const BALL_HUES = ['#ffffff', '#ffc61a', '#1f5bff', '#ff2a36', '#9440ff', '#ff7a14', '#14c566', '#b01d45', '#101014'];
export const ballHue = (n: number) => BALL_HUES[n === 0 ? 0 : n === 8 ? 8 : ((n - 1) % 8) % 7 + 1];

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

const cache = new Map<number, THREE.CanvasTexture>();

/** Equirect ball skin: solid/stripe/8/cue with number discs on opposite sides. */
export function ballTexture(n: number): THREE.CanvasTexture {
  const hit = cache.get(n);
  if (hit) return hit;
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const col = ballHue(n);
  const stripe = n >= 9;
  g.fillStyle = stripe || n === 0 ? '#f7f3ea' : col;
  g.fillRect(0, 0, W, H);
  if (stripe) {
    g.fillStyle = col;
    g.fillRect(0, H * 0.27, W, H * 0.46);
  }
  if (n === 0) {
    // cue ball: faint red dots help read spin while it rolls
    g.fillStyle = '#e0304a';
    for (const [u, v] of [[0.25, 0.5], [0.75, 0.5], [0.5, 0.15], [0.0, 0.85]]) {
      g.beginPath(); g.arc(u * W, v * H, 7, 0, Math.PI * 2); g.fill();
    }
  } else {
    for (const u of [0.25, 0.75]) {
      const cx = u * W, cy = H / 2;
      g.fillStyle = '#f7f3ea';
      g.beginPath(); g.ellipse(cx, cy, H * 0.2, H * 0.19, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111';
      g.font = `bold ${n >= 10 ? 52 : 60}px "Arial Black", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy + 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(n, t);
  return t;
}

/** Fine felt nap + a soft darker falloff toward the rails. */
export function feltTexture(): THREE.CanvasTexture {
  const W = 512, H = 1024;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#0f4a5a';
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = (rnd() - 0.5) * 14;
    img.data[i] += k; img.data[i + 1] += k; img.data[i + 2] += k;
  }
  g.putImageData(img, 0, 0);
  const grad = g.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.62);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(3,6,20,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // head string + foot spot, faint. Canvas top = near end (−Z) once laid flat.
  g.fillStyle = 'rgba(220,240,255,0.18)';
  g.fillRect(0, H * 0.25 - 1, W, 2);
  g.beginPath(); g.arc(W / 2, H * 0.75, 4, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
