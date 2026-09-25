'use client';

// Shot-clock pill for turn-based games. Ticks on its own (no parent
// re-renders); shown only when the table is waiting on someone to shoot.
// On your own turn the last 10 s turn urgent, with a buzz as it starts.

import { useEffect, useRef, useState } from 'react';

interface Props {
  deadline: number | null | undefined; // local ms
  maxMs: number;                       // clock length — hides the replay allowance
  mine: boolean;
  who?: string;                        // shooter's name when it isn't me
  visible: boolean;
}

const URGENT_S = 10;

export function ShotClock({ deadline, maxMs, mine, who, visible }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef<number | null>(null);

  useEffect(() => {
    if (!deadline || !visible) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline, visible]);

  const left = deadline ? Math.min(maxMs, deadline - now) / 1000 : Infinity;
  const secs = Math.max(0, Math.ceil(left));
  const urgent = mine && secs <= URGENT_S;

  useEffect(() => {
    if (urgent && deadline && buzzed.current !== deadline) {
      buzzed.current = deadline;
      try { navigator.vibrate?.([60, 80, 60]); } catch { /* not supported */ }
    }
  }, [urgent, deadline]);

  if (!deadline || !visible || !Number.isFinite(left)) return null;

  const frac = Math.max(0, Math.min(1, (left * 1000) / maxMs));
  const color = urgent ? '#ff4d6d' : secs <= URGENT_S ? '#ffb424' : '#9bf6ff';

  return (
    <div
      className="pointer-events-none flex items-center gap-2 rounded-full px-3 py-1"
      style={{
        background: 'rgba(10,8,18,0.72)', border: `1px solid ${color}55`,
        boxShadow: urgent ? `0 0 18px ${color}88` : undefined,
        animation: urgent ? 'shotClockPulse 0.9s ease-in-out infinite' : undefined,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle
          cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${frac * 50.27} 50.27`} transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="text-[12px] font-bold tracking-[0.12em] uppercase" style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {urgent ? `Shoot! ${secs}` : mine ? `${secs}s` : `${who ?? 'Their'} · ${secs}s`}
      </span>
      <style>{`@keyframes shotClockPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}`}</style>
    </div>
  );
}
