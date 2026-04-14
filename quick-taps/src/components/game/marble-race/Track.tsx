'use client';

import { useEffect, useRef } from 'react';

const W = 390;
const H = 2800;

const BG = '#1C1B16';
const CHANNEL_FILL = '#DEDAD4';
const CHANNEL_WALL = '#888780';
const PEG_COLOR = '#6B6965';
const PEG_STROKE = '#555450';
const FINISH_COLOR = '#E24B4A';

const CHANNEL_W = 60;
const WALL_W = 2;

// ─── Act 1: Plinko (y: 0–800) ────────────────────────────────────────────────

function drawAct1(ctx: CanvasRenderingContext2D) {
  // Channel fill
  ctx.fillStyle = CHANNEL_FILL;
  ctx.fillRect(40, 0, 310, 800);

  // Left and right walls
  ctx.strokeStyle = CHANNEL_WALL;
  ctx.lineWidth = WALL_W;
  ctx.beginPath();
  ctx.moveTo(40, 0);
  ctx.lineTo(40, 800);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(350, 0);
  ctx.lineTo(350, 800);
  ctx.stroke();

  // Peg grid — 8 rows, vertical spacing 80px, first row y=80
  // Even rows (0,2,4,6): 5 pegs at x=75,135,195,255,315 (60px horizontal spacing, centered at 195)
  // Odd rows  (1,3,5,7): 4 pegs at x=105,165,225,285     (staggered 30px right)
  const evenX = [75, 135, 195, 255, 315];
  const oddX  = [105, 165, 225, 285];

  for (let row = 0; row < 8; row++) {
    const y = 80 + row * 80;
    const xs = row % 2 === 0 ? evenX : oddX;
    for (const x of xs) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = PEG_COLOR;
      ctx.fill();
      ctx.strokeStyle = PEG_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ─── Act 2: Crossing lanes (y: 800–2000) ─────────────────────────────────────

/**
 * Build the centerline path for one lane (0=A, 1=B, 2=C, 3=D).
 *
 * Key x positions at each stage [A, B, C, D]:
 *   Entry     y=800 : [80, 160, 230, 310]
 *   Post-X1  y=1140 : [230, 310, 80, 160]   (A↔C and B↔D swap)
 *   Post-X2  y=1430 : [160, 80, 310, 230]   (180° CW rotation: x → 390−x)
 *   Post-X3  y=1700 : [80, 160, 230, 310]   (A↔B and C↔D swap, back to entry)
 *   Funnel   y=2000 : 195 (all converge)
 */
function buildLanePath(ctx: CanvasRenderingContext2D, lane: number): void {
  const x0 = [80,  160, 230, 310][lane]; // entry
  const x1 = [230, 310, 80,  160][lane]; // after crossing 1
  const x2 = [160, 80,  310, 230][lane]; // after crossing 2
  const x3 = [80,  160, 230, 310][lane]; // after crossing 3
  const xF = 195;                         // funnel entry

  // Crossing 2 control points — swing outward for the spiral effect
  // CP1 pushes in the same lateral direction as the lane's current side;
  // CP2 pulls toward the destination from the opposite side.
  const c2p1x = [280, 340, 50,  110][lane];
  const c2p2x = [110, 50,  340, 280][lane];

  ctx.beginPath();
  ctx.moveTo(x0, 800);
  ctx.lineTo(x0, 960);

  // Crossing 1 (y: 960→1140) — A↔C and B↔D
  ctx.bezierCurveTo(x0, 1020, x1, 1080, x1, 1140);

  ctx.lineTo(x1, 1270);

  // Crossing 2 (y: 1270→1430) — 180° clockwise spiral, all four lanes rotate
  ctx.bezierCurveTo(c2p1x, 1330, c2p2x, 1390, x2, 1430);

  ctx.lineTo(x2, 1570);

  // Crossing 3 (y: 1570→1700) — shallow A↔B and C↔D
  ctx.bezierCurveTo(x2, 1615, x3, 1655, x3, 1700);

  ctx.lineTo(x3, 1880);

  // Converge to funnel entry (y: 1880→2000)
  ctx.bezierCurveTo(x3, 1940, xF, 1975, xF, 2000);
}

function drawAct2(ctx: CanvasRenderingContext2D) {
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  for (let i = 0; i < 4; i++) {
    // Wall layer (outer edge, 2px each side)
    buildLanePath(ctx, i);
    ctx.strokeStyle = CHANNEL_WALL;
    ctx.lineWidth = CHANNEL_W + WALL_W * 2;
    ctx.stroke();

    // Fill layer
    buildLanePath(ctx, i);
    ctx.strokeStyle = CHANNEL_FILL;
    ctx.lineWidth = CHANNEL_W;
    ctx.stroke();
  }
}

// ─── Act 3: Funnel (y: 2000–2800) ────────────────────────────────────────────

function drawAct3(ctx: CanvasRenderingContext2D) {
  const cx     = 195;
  const cy     = 2200;
  const rOuter = 140;
  const rInner = 20;
  const funnelTop = cy - rOuter; // y = 2060
  const funnelBot = cy + rOuter; // y = 2340

  ctx.lineCap = 'butt';

  // Entry channel: converged lanes (y=2000) → funnel rim top (y=2060)
  ctx.strokeStyle = CHANNEL_WALL;
  ctx.lineWidth = CHANNEL_W + WALL_W * 2;
  ctx.beginPath();
  ctx.moveTo(cx, 2000);
  ctx.lineTo(cx, funnelTop + 1);
  ctx.stroke();

  ctx.strokeStyle = CHANNEL_FILL;
  ctx.lineWidth = CHANNEL_W;
  ctx.beginPath();
  ctx.moveTo(cx, 2000);
  ctx.lineTo(cx, funnelTop + 1);
  ctx.stroke();

  // Funnel bowl — filled annulus between rInner and rOuter
  // 1. Fill outer disk
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.fillStyle = CHANNEL_FILL;
  ctx.fill();

  // 2. Outer wall stroke
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.strokeStyle = CHANNEL_WALL;
  ctx.lineWidth = WALL_W;
  ctx.stroke();

  // 3. Punch inner hole
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fillStyle = BG;
  ctx.fill();

  // 4. Inner wall stroke
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.strokeStyle = CHANNEL_WALL;
  ctx.lineWidth = WALL_W;
  ctx.stroke();

  // Exit chute: funnel bottom (y=2340) → canvas bottom (y=2800)
  ctx.strokeStyle = CHANNEL_WALL;
  ctx.lineWidth = CHANNEL_W + WALL_W * 2;
  ctx.beginPath();
  ctx.moveTo(cx, funnelBot - 1);
  ctx.lineTo(cx, H);
  ctx.stroke();

  ctx.strokeStyle = CHANNEL_FILL;
  ctx.lineWidth = CHANNEL_W;
  ctx.beginPath();
  ctx.moveTo(cx, funnelBot - 1);
  ctx.lineTo(cx, H);
  ctx.stroke();
}

// ─── Finish line (y: 2750) ────────────────────────────────────────────────────

function drawFinishLine(ctx: CanvasRenderingContext2D) {
  const y  = 2750;
  const x1 = 195 - 30; // 165 — channel left edge
  const x2 = 195 + 30; // 225 — channel right edge
  const sq = 10;        // square size
  const cols = (x2 - x1) / sq; // 6 squares across

  // Two-row checkered band above the line
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#FFFFFF' : '#222222';
      ctx.fillRect(x1 + col * sq, y - 2 * sq + row * sq, sq, sq);
    }
  }

  // Red finish line
  ctx.strokeStyle = FINISH_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

// ─── Main draw ────────────────────────────────────────────────────────────────

function drawTrack(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  drawAct1(ctx);
  drawAct2(ctx);
  drawAct3(ctx);
  drawFinishLine(ctx);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Track() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawTrack(ctx);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ display: 'block' }}
    />
  );
}
