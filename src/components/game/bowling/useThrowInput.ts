'use client';

import { useEffect, useRef, useState } from 'react';
import type { ThrowParams } from '@/types/bowling';

export function useThrowInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onThrow: (params: ThrowParams) => void,
): { phase: 'aiming' | 'throwing'; aimX: number } {
  const [gesturePhase, setGesturePhase] = useState<'aiming' | 'throwing'>('aiming');
  const [aimX, setAimX] = useState(0);

  // Refs to avoid stale closures
  const aimXRef = useRef(0);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const inThrowRef = useRef(false);
  const swipePathRef = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    if (!enabled) {
      setGesturePhase('aiming');
      setAimX(0);
      aimXRef.current = 0;
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      inThrowRef.current = false;
      swipePathRef.current = [];
      setGesturePhase('aiming');
    }

    function onTouchMove(e: TouchEvent) {
      if (!startPosRef.current) return;
      const touch = e.touches[0];
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;

      if (!inThrowRef.current) {
        // Horizontal aim — update aimX
        const newAimX = Math.max(-1, Math.min(1, (touch.clientX - centerX) / (rect.width / 2)));
        aimXRef.current = newAimX;
        setAimX(newAimX);

        // Check for upward swipe to enter throw phase
        const dy = touch.clientY - startPosRef.current.y;
        if (dy < -20) {
          inThrowRef.current = true;
          swipePathRef.current = [{ x: touch.clientX, y: touch.clientY }];
          setGesturePhase('throwing');
        }
      } else {
        // Throw phase — track path, suppress scroll
        e.preventDefault();
        swipePathRef.current.push({ x: touch.clientX, y: touch.clientY });
      }
    }

    function onTouchEnd() {
      if (!inThrowRef.current || swipePathRef.current.length < 2) {
        inThrowRef.current = false;
        setGesturePhase('aiming');
        return;
      }

      const path = swipePathRef.current;
      const first = path[0];
      const last = path[path.length - 1];

      // Power: upward distance from entry into throw phase
      const totalDist = Math.max(0, first.y - last.y);
      const power = Math.min(1, totalDist / 300);

      // Spin: mid-point deviation from the straight line
      const midIdx = Math.floor(path.length / 2);
      const midX = path[midIdx].x;
      const expectedMidX = (first.x + last.x) / 2;
      const spin = Math.max(-1, Math.min(1, (midX - expectedMidX) / 50));

      inThrowRef.current = false;
      setGesturePhase('aiming');

      onThrow({
        direction: aimXRef.current * (Math.PI / 6),
        power,
        spin,
        pinState: [], // caller (BowlingScene) overrides with real pinState
      });
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, containerRef, onThrow]);

  return { phase: gesturePhase, aimX };
}
