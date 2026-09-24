'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

// Swipe-to-bowl gesture, in *screen* terms (+x = right on screen).
// The caller maps to world space (the camera looks down +Z, so screen-right is −X).
//
//   drag sideways   → line up, snapping board by board (the precise part)
//   flick upward    → release. Forgiving by design: any deliberate flick is a
//                     strike-capable speed, and a crooked flick only nudges the line
//   clearly curve it → hook. A thumb's natural arc reads as straight

export interface SwipeResult {
  aim: number;       // −1..1 screen-space lane position at release
  direction: number; // radians, +right on screen
  speed: number;     // m/s
  spin: number;      // −1..1, +curves right on screen
}

interface Pt { x: number; y: number; t: number }

// Lane boards: 39 across 1.06 m. Aim is −1..1 over ±0.45 m of lane.
const BOARD_W = 1.06 / 39;
const AIM_RANGE_M = 0.45;
export const snapAimToBoard = (aim: number) =>
  (Math.round((aim * AIM_RANGE_M) / BOARD_W) * BOARD_W) / AIM_RANGE_M;

/**
 * Flick → throw. Pure so it can be calibrated offline against simulated thumbs.
 *  chord: heading of the whole flick (rad, +right), arc: late heading − early heading,
 *  screensPerSec: release speed of the flick in screen-heights per second.
 */
export function mapFlick(chord: number, arc: number, screensPerSec: number) {
  // Speed: 6.4 m/s floor (≈14 mph — already carries), up to 9 m/s for a hard flick.
  const u = Math.max(0, Math.min(1, (screensPerSec - 0.5) / 3));
  const speed = 6.4 + Math.sqrt(u) * 2.6;
  // Direction: small nudge only; ±5° of flick tilt is ignored entirely.
  const DEAD = 0.09;
  const tilt = Math.sign(chord) * Math.max(0, Math.abs(chord) - DEAD);
  const direction = Math.max(-0.018, Math.min(0.018, tilt * 0.03));
  // Hook: a natural thumb arc (up to ~20°) is straight; beyond that, ramps to full.
  const ARC_DEAD = 0.35;
  const mag = Math.max(0, Math.abs(arc) - ARC_DEAD) / 0.8;
  const spin = Math.sign(arc) * Math.min(1, mag);
  return { direction, speed, spin };
}

const LOCK_UP_PX = 28;      // upward travel that turns a drag into a throw
const MIN_THROW_PX = 70;

export function useSwipeThrow(
  el: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onAim: (aim: number) => void,
  onThrow: (r: SwipeResult) => void,
) {
  const cb = useRef({ onAim, onThrow });
  useLayoutEffect(() => { cb.current = { onAim, onThrow }; });
  const aimRef = useRef(0);

  useEffect(() => {
    const node = el.current;
    if (!node || !enabled) return;
    let pts: Pt[] = [];
    let down = false;
    let lockIdx = -1;
    let aim0Raw = 0, x0 = 0;
    let rawAim = aimRef.current;
    let lowestY = 0;

    const pt = (e: PointerEvent): Pt => ({ x: e.clientX, y: e.clientY, t: performance.now() });

    const onDown = (e: PointerEvent) => {
      down = true;
      try { node.setPointerCapture(e.pointerId); } catch {}
      const p = pt(e);
      pts = [p];
      lockIdx = -1;
      aim0Raw = rawAim;
      x0 = p.x;
      lowestY = p.y;
    };

    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const p = pt(e);
      pts.push(p);
      if (lockIdx < 0) {
        lowestY = Math.max(lowestY, p.y);
        if (lowestY - p.y > LOCK_UP_PX) {
          // Commit to a throw from the lowest point of the stroke
          let li = pts.length - 1;
          for (let i = pts.length - 1; i >= 0; i--) if (pts[i].y === lowestY) { li = i; break; }
          lockIdx = li;
        } else {
          const w = node.clientWidth;
          const raw = Math.max(-1, Math.min(1, aim0Raw + ((p.x - x0) / w) * 1.7));
          const snapped = snapAimToBoard(raw);
          if (snapped !== aimRef.current) {
            aimRef.current = snapped;
            cb.current.onAim(snapped);
            try { navigator.vibrate?.(3); } catch {}
          }
          rawAim = raw;
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      pts.push(pt(e));
      const stroke = lockIdx >= 0 ? pts.slice(lockIdx) : [];
      const first = stroke[0], last = stroke[stroke.length - 1];
      if (!first || first.y - last.y < MIN_THROW_PX) return;
      const h = node.clientHeight;

      // Release speed from the last ~90ms of the flick
      let j = stroke.length - 1;
      while (j > 0 && last.t - stroke[j].t < 90) j--;
      const dy = stroke[j].y - last.y;
      const dt = Math.max(16, last.t - stroke[j].t);
      const screensPerSec = (dy / h) / (dt / 1000);

      // Whole-flick heading, and how much the end bends away from the start
      const mid = stroke[Math.floor(stroke.length / 2)];
      const late = stroke[Math.floor(stroke.length * 0.66)];
      const heading = (a: Pt, b: Pt) => Math.atan2(b.x - a.x, a.y - b.y);
      const chord = heading(first, last);
      const arc = heading(late, last) - heading(first, mid);

      cb.current.onThrow({ aim: aimRef.current, ...mapFlick(chord, arc, screensPerSec) });
    };

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
    };
  }, [el, enabled]);

  return aimRef;
}

