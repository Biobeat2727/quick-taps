'use client';

// Procedural canvas textures for the cosmic lane — no image assets to ship.

import * as THREE from 'three';
import { LANE_HALF_WIDTH } from '@/lib/bowling/bowling-constants';

export const LANE_START = 0;
export const LANE_END = 18.5;
const LANE_LEN = LANE_END - LANE_START;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Tiny deterministic hash noise so textures look the same on every device.
function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lane surface. Canvas y=0 is the foul line; y=H is the pin end.
 * Returns the wood colour map and an emissive map carrying the
 * blacklight-reactive markings (arrows, dots, foul line).
 */
export function makeLaneTextures() {
  const W = 256, H = 4096;
  const pxPerM = H / LANE_LEN;
  const zToY = (z: number) => (z - LANE_START) * pxPerM;
  const xToX = (x: number) => ((x + LANE_HALF_WIDTH) / (LANE_HALF_WIDTH * 2)) * W;
  const r = rand(7);

  // ── Wood ────────────────────────────────────────────────────────────────
  const [wc, w] = canvas(W, H);
  const boards = 39;
  const bw = W / boards;
  for (let b = 0; b < boards; b++) {
    const tone = 18 + r() * 10;
    w.fillStyle = `hsl(${22 + r() * 8}, ${35 + r() * 10}%, ${tone}%)`;
    w.fillRect(b * bw, 0, bw + 0.5, H);
    // grain streaks
    for (let g = 0; g < 26; g++) {
      w.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
      const gx = b * bw + r() * bw;
      const gy = r() * H;
      w.fillRect(gx, gy, 0.6, 60 + r() * 400);
    }
    w.fillStyle = 'rgba(0,0,0,0.35)';
    w.fillRect(b * bw, 0, 0.6, H);
  }
  // Board end joints in the heads (lighter maple "pine" section feel)
  for (let b = 0; b < boards; b++) {
    const jy = zToY(4.6 + r() * 0.6);
    w.fillStyle = 'rgba(0,0,0,0.4)';
    w.fillRect(b * bw, jy, bw, 1);
  }
  // Oil sheen gradient: front of the lane darker/glossier
  const oil = w.createLinearGradient(0, 0, 0, zToY(13));
  oil.addColorStop(0, 'rgba(10,4,20,0.35)');
  oil.addColorStop(1, 'rgba(10,4,20,0)');
  w.fillStyle = oil;
  w.fillRect(0, 0, W, zToY(13));

  // ── Emissive markings ───────────────────────────────────────────────────
  const [ec, e] = canvas(W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);

  const boardX = (n: number) => W - (n - 0.5) * bw; // board 1 = right edge, like a real lane

  // Range-finder dots at 7ft (2.13m)
  e.fillStyle = '#9bf6ff';
  for (const n of [3, 5, 8, 11, 14]) {
    for (const x of [boardX(n), W - boardX(n)]) {
      e.beginPath(); e.arc(x, zToY(2.13), 2.2, 0, Math.PI * 2); e.fill();
    }
  }
  // Target arrows at ~15ft, V formation
  const arrowBoards = [5, 10, 15, 20, 25, 30, 35];
  arrowBoards.forEach((n) => {
    const x = boardX(n);
    const depth = 20 - Math.abs(n - 20);
    const z = 4.4 + (depth / 15) * 0.45;
    const y = zToY(z);
    e.fillStyle = n === 20 ? '#ff4fd8' : '#ff9a3c';
    e.beginPath();
    e.moveTo(x, y + 34);
    e.lineTo(x - 3.2, y);
    e.lineTo(x + 3.2, y);
    e.closePath();
    e.fill();
  });
  // Foul line
  e.fillStyle = '#ff2e63';
  e.fillRect(0, 0, W, 5);
  // Pin spot guides on the deck
  e.fillStyle = 'rgba(180,120,255,0.55)';

  // Lane edge pinstripes
  e.fillStyle = '#7a5cff';
  e.fillRect(0, 0, 1.5, H);
  e.fillRect(W - 1.5, 0, 1.5, H);

  const map = tex(wc);
  const emissiveMap = tex(ec);
  return { map, emissiveMap, xToX, zToY };
}

/**
 * Pin texture for a lathe whose v runs linearly from base (0) to crown (1).
 * White body with two neck stripes that fluoresce hot pink under blacklight.
 */
export function makePinTextures(stripeV: [number, number][]) {
  const W = 8, H = 512;
  const [cc, c] = canvas(W, H);
  const [ec, e] = canvas(W, H);
  c.fillStyle = '#f4f1ff';
  c.fillRect(0, 0, W, H);
  e.fillStyle = '#2a2350'; // faint violet body fluorescence
  e.fillRect(0, 0, W, H);
  for (const [v0, v1] of stripeV) {
    // canvas y=0 is the top of the texture = v=1
    const y0 = (1 - v1) * H, y1 = (1 - v0) * H;
    c.fillStyle = '#e8114f';
    c.fillRect(0, y0, W, y1 - y0);
    e.fillStyle = '#ff2a78';
    e.fillRect(0, y0, W, y1 - y0);
  }
  const map = tex(cc);
  const emissiveMap = tex(ec);
  return { map, emissiveMap };
}

/** Galaxy-swirl urethane ball: equirect colour + glowing fleck map. */
export function makeBallTextures() {
  const W = 512, H = 256;
  const [cc, c] = canvas(W, H);
  const [ec, e] = canvas(W, H);
  const img = c.createImageData(W, H);
  const eimg = e.createImageData(W, H);
  const r = rand(42);

  // Low-res value noise lattice, bilinear sampled, 3 octaves — warped for swirl
  const G = 32;
  const lat = Array.from({ length: G * G }, () => r());
  const vn = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const at = (i: number, j: number) => lat[((j % G + G) % G) * G + ((i % G + G) % G)];
    const s = (t: number) => t * t * (3 - 2 * t);
    const a = at(xi, yi), b = at(xi + 1, yi), c2 = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c2 - a) * s(yf) + (a - b - c2 + d) * s(xf) * s(yf);
  };
  const fbm = (x: number, y: number) => vn(x, y) * 0.55 + vn(x * 2.1, y * 2.1) * 0.3 + vn(x * 4.3, y * 4.3) * 0.15;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * 8, v = (y / H) * 4;
      const wx = fbm(u + 3.1, v) * 3, wy = fbm(u, v + 7.7) * 3;
      const n = fbm(u + wx, v + wy);
      const band = Math.sin(n * 14) * 0.5 + 0.5;
      const i = (y * W + x) * 4;
      // deep indigo → violet → magenta veins
      img.data[i] = 20 + band * 120 * n;
      img.data[i + 1] = 8 + band * 30;
      img.data[i + 2] = 60 + band * 150;
      img.data[i + 3] = 255;
      const vein = Math.max(0, band - 0.86) * 7;
      eimg.data[i] = 255 * vein * 0.9;
      eimg.data[i + 1] = 60 * vein;
      eimg.data[i + 2] = 255 * vein;
      eimg.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  e.putImageData(eimg, 0, 0);
  // glitter flecks
  for (let k = 0; k < 260; k++) {
    const x = r() * W, y = H * (0.1 + r() * 0.8);
    const hue = r() < 0.5 ? '#6ff7ff' : '#ffd3ff';
    e.fillStyle = hue;
    e.fillRect(x, y, 1.4, 1.4);
    c.fillStyle = hue;
    c.fillRect(x, y, 1, 1);
  }
  return { map: tex(cc), emissiveMap: tex(ec) };
}

/** Masking-unit art above the pin deck. */
export function makeMaskTexture() {
  const W = 1024, H = 256;
  const [mc, m] = canvas(W, H);
  const g = m.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#12051f');
  g.addColorStop(0.5, '#1c0833');
  g.addColorStop(1, '#12051f');
  m.fillStyle = g;
  m.fillRect(0, 0, W, H);
  const r = rand(3);
  for (let k = 0; k < 140; k++) {
    m.fillStyle = `rgba(200,180,255,${0.2 + r() * 0.6})`;
    m.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  // Planet rings / swooshes
  m.lineWidth = 6;
  for (const [col, off] of [['#ff3fd0', 0], ['#3ff2ff', 18], ['#ffb424', 36]] as const) {
    m.strokeStyle = col;
    m.shadowColor = col;
    m.shadowBlur = 18;
    m.beginPath();
    m.ellipse(W / 2, H / 2 + 30, 420 - off, 70 - off / 3, -0.06, Math.PI * 1.05, Math.PI * 1.95);
    m.stroke();
  }
  m.shadowBlur = 24;
  m.shadowColor = '#ff3fd0';
  m.fillStyle = '#ffe6fb';
  m.font = 'bold 92px "Bungee", "Arial Black", sans-serif';
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  m.fillText('QUICK TAPS', W / 2, H / 2 - 12);
  return tex(mc);
}
