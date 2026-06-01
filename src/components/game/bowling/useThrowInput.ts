'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ThrowParams } from '@/types/bowling';

const CHARGE_DURATION = 1500; // ms to reach full power

export function useThrowInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onThrow: (params: ThrowParams) => void,
): {
  aimX: number;
  isCharging: boolean;
  chargeProgressRef: React.RefObject<number>;
  startCharge: () => void;
  releaseCharge: () => void;
} {
  const [aimX, setAimX] = useState(0);
  const [isCharging, setIsCharging] = useState(false);

  const aimXRef = useRef(0);
  const chargeProgressRef = useRef(0);
  const chargeStartRef = useRef(0);
  const chargeRafRef = useRef(0);
  const isChargingRef = useRef(false);
  const onThrowRef = useRef(onThrow);
  onThrowRef.current = onThrow;

  // ── Aim tracking ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setAimX(0);
      aimXRef.current = 0;
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0];
      const rect = el!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const newAimX = Math.max(-1, Math.min(1, (touch.clientX - centerX) / (rect.width / 2)));
      aimXRef.current = newAimX;
      setAimX(newAimX);
    }

    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [enabled, containerRef]);

  // ── Charge loop ─────────────────────────────────────────────────────────────

  const startCharge = useCallback(() => {
    if (!enabled || isChargingRef.current) return;
    isChargingRef.current = true;
    chargeProgressRef.current = 0;
    chargeStartRef.current = Date.now();
    setIsCharging(true);

    function tick() {
      chargeProgressRef.current = Math.min(1, (Date.now() - chargeStartRef.current) / CHARGE_DURATION);
      if (isChargingRef.current) {
        chargeRafRef.current = requestAnimationFrame(tick);
      }
    }
    chargeRafRef.current = requestAnimationFrame(tick);
  }, [enabled]);

  const releaseCharge = useCallback(() => {
    if (!isChargingRef.current) return;
    isChargingRef.current = false;
    cancelAnimationFrame(chargeRafRef.current);
    setIsCharging(false);

    onThrowRef.current({
      direction: aimXRef.current * (Math.PI / 6),
      power: chargeProgressRef.current,
      spin: 0,
      pinState: [], // BowlingScene overrides with real pinState
    });

    chargeProgressRef.current = 0;
  }, []);

  // ── Cleanup on disable ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled && isChargingRef.current) {
      isChargingRef.current = false;
      cancelAnimationFrame(chargeRafRef.current);
      chargeProgressRef.current = 0;
      setIsCharging(false);
    }
  }, [enabled]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(chargeRafRef.current);
    };
  }, []);

  return { aimX, isCharging, chargeProgressRef, startCharge, releaseCharge };
}
