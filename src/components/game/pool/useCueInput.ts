'use client';

import { useEffect, useRef, useState } from 'react';
import type { PoolShotParams } from '@/types/pool';

export function useCueInput(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  cueBallScreenPos: { x: number; y: number },
  onShoot: (params: Pick<PoolShotParams, 'angle' | 'power'>) => void,
): { phase: 'aiming' | 'shooting'; aimAngle: number; power: number; isDragging: boolean } {
  const [aimAngle, setAimAngle] = useState(0);
  const [power, setPower] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<'aiming' | 'shooting'>('aiming');

  const draggingRef = useRef(false);
  const aimAngleRef = useRef(0);
  const powerRef = useRef(0);
  const cueBallPosRef = useRef(cueBallScreenPos);
  const onShootRef = useRef(onShoot);

  useEffect(() => { cueBallPosRef.current = cueBallScreenPos; }, [cueBallScreenPos]);
  useEffect(() => { onShootRef.current = onShoot; }, [onShoot]);

  // Reset to aiming when re-enabled (new turn)
  useEffect(() => {
    if (enabled) {
      setPhase('aiming');
      draggingRef.current = false;
      setIsDragging(false);
    }
  }, [enabled]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function updateAim(clientX: number, clientY: number) {
      const { x, y } = cueBallPosRef.current;
      const dx = clientX - x;
      const dy = clientY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(Math.max(dist, 10), 150);
      aimAngleRef.current = Math.atan2(dx, dy);
      powerRef.current = clamped / 150;
      setAimAngle(aimAngleRef.current);
      setPower(powerRef.current);
    }

    function handlePointerDown(e: PointerEvent) {
      if (!enabled) return;
      draggingRef.current = true;
      setIsDragging(true);
      updateAim(e.clientX, e.clientY);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      updateAim(e.clientX, e.clientY);
    }

    function handlePointerUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      setPhase('shooting');
      onShootRef.current({ angle: aimAngleRef.current, power: powerRef.current });
    }

    el.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [containerRef, enabled]);

  return { phase, aimAngle, power, isDragging };
}
