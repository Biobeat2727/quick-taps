'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { ThrowParams } from '@/types/bowling';

const POWER_HALF_PERIOD = 1800; // ms per direction (0→1, then 1→0)
const SPIN_RAMP_RATE    = 1.5;  // spin units/sec while button held (reaches ±1 in ~0.67s)

export function useThrowInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onThrow: (params: ThrowParams) => void,
): {
  aimXRef:    React.RefObject<number>;
  powerRef:   React.RefObject<number>;
  spinRef:    React.RefObject<number>;
  setSpinDir: (dir: -1 | 0 | 1) => void;
  doThrow:    () => void;
} {
  const aimXRef    = useRef(0);
  const spinRef    = useRef(0);
  const spinDirRef = useRef<-1 | 0 | 1>(0);
  const powerRef   = useRef(0);
  const onThrowRef = useRef(onThrow);
  onThrowRef.current = onThrow;

  // ── Horizontal drag → lane position ────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      aimXRef.current = 0;
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0];
      const rect  = el!.getBoundingClientRect();
      const cx    = rect.left + rect.width / 2;
      aimXRef.current = Math.max(-1, Math.min(1, (touch.clientX - cx) / (rect.width / 2)));
    }

    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [enabled, containerRef]);

  // ── Oscillate power + ramp spin while enabled ───────────────────────────────

  useEffect(() => {
    if (!enabled) {
      powerRef.current   = 0;
      spinRef.current    = 0;
      spinDirRef.current = 0;
      return;
    }

    let raf: number;
    const startTime = performance.now();
    let lastTime    = startTime;

    function tick(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Triangle wave: 0 → 1 → 0 → 1 → …
      const t = (now - startTime) % (POWER_HALF_PERIOD * 2);
      powerRef.current = t < POWER_HALF_PERIOD
        ? t / POWER_HALF_PERIOD
        : 1 - (t - POWER_HALF_PERIOD) / POWER_HALF_PERIOD;

      // Spin ramp while hook button held
      const dir = spinDirRef.current;
      if (dir !== 0) {
        spinRef.current = Math.max(-1, Math.min(1, spinRef.current + dir * SPIN_RAMP_RATE * dt));
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const setSpinDir = useCallback((dir: -1 | 0 | 1) => {
    spinDirRef.current = dir;
  }, []);

  const doThrow = useCallback(() => {
    if (!enabled) return;
    onThrowRef.current({
      startX:    aimXRef.current * 0.45,
      direction: 0,
      power:     powerRef.current,
      spin:      spinRef.current,
      pinState:  [],
    });
  }, [enabled]);

  return { aimXRef, powerRef, spinRef, setSpinDir, doThrow };
}
