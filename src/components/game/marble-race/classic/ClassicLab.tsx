'use client';

// /marble-classic — the archived original 3D map (Classic Funnel), solo and
// offline: runs the real simulation in the browser, then replays it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ClassicRaceScene from './ClassicRaceScene';
import { simulateClassicRace } from '@/lib/marble/classic/simulate-classic';
import { MARBLE_COLORS, NPC_NAMES } from '@/lib/constants';
import type { SessionPlayer } from '@/types/session';
import type { ClassicRecording } from '@/types/race';

export function ClassicLab() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [result, setResult] = useState<{ seed: number; rec: ClassicRecording } | null>(null);
  const rec = result?.seed === seed ? result.rec : null;

  const players: SessionPlayer[] = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    id: i === 0 ? 'me' : `npc-${i}`,
    name: i === 0 ? 'You' : NPC_NAMES[i - 1],
    color: MARBLE_COLORS[i].hex,
    isNpc: i !== 0,
  })), []);

  useEffect(() => {
    let cancelled = false;
    void simulateClassicRace(players, seed).then((r) => { if (!cancelled) setResult({ seed, rec: r }); });
    return () => { cancelled = true; };
  }, [players, seed]);

  const again = useCallback(() => setSeed(Math.floor(Math.random() * 1e9)), []);

  if (!rec) {
    return (
      <main style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0A14' }}>
        <span className="neon-sign" style={{ fontSize: 22 }}>Building the classic course…</span>
      </main>
    );
  }

  return (
    <ClassicRaceScene
      key={seed}
      players={players}
      myPlayerId="me"
      recording={rec}
      onLeave={() => { window.location.href = '/'; }}
      onRaceAgain={again}
    />
  );
}
