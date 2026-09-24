'use client';

// /marble-lab — solo, no network. Simulates a full race in the browser with
// the same core the server will use, then replays it.
// Query: ?n=8 (marbles) &seed=123 &projector (leader cam, no "you") &t=48 (start 48 s in)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapRaceScene, { type MapRecording } from './MapRaceScene';
import { runRaceSim } from '@/lib/marble/race-sim-core';
import { NEON_SUMMIT } from '@/lib/marble/maps/neon-summit';
import { MARBLE_COLORS } from '@/lib/constants';
import type { Participant } from './marble-race-shared';

const NAMES = ['Big Mike', 'Hopsy', 'The Regular', 'Sudsy', 'Last Call', 'Tab', 'Foamy', 'Barback', 'Growler', 'Keg Stand', 'Nightcap'];

export function MarbleLab() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const n = Math.max(2, Math.min(12, Number(params.get('n') ?? 8)));
  const projector = params.has('projector');
  const startAt = Number(params.get('t') ?? 0);
  const [seed, setSeed] = useState(() => Number(params.get('seed') ?? Math.floor(Math.random() * 1e9)));
  const [rec, setRec] = useState<MapRecording | null>(null);
  const [simMs, setSimMs] = useState(0);
  const speed = useRef(1);
  const [speedLabel, setSpeedLabel] = useState('1×');

  const participants: Participant[] = useMemo(() => Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? 'me' : `npc-${i}`,
    name: i === 0 ? 'You' : NAMES[(i - 1) % NAMES.length],
    color: i < MARBLE_COLORS.length ? MARBLE_COLORS[i].hex : `hsl(${(i * 67) % 360} 80% 60%)`,
  })), [n]);

  useEffect(() => {
    let cancelled = false;
    setRec(null);
    void (async () => {
      const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
      await RAPIER.init();
      await new Promise((r) => setTimeout(r, 30)); // let "Building…" paint
      const t0 = performance.now();
      const res = runRaceSim(RAPIER, NEON_SUMMIT, n, seed);
      if (cancelled) return;
      setSimMs(performance.now() - t0);
      setRec(res);
    })();
    return () => { cancelled = true; };
  }, [seed, n]);

  const again = useCallback(() => setSeed(Math.floor(Math.random() * 1e9)), []);

  if (!rec) {
    return (
      <main style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#07050d' }}>
        <span className="neon-sign" style={{ fontSize: 22 }}>Building the course…</span>
      </main>
    );
  }

  return (
    <>
      <MapRaceScene
        key={seed}
        map={NEON_SUMMIT}
        participants={participants}
        myPlayerId={projector ? '' : 'me'}
        isProjector={projector}
        recording={rec}
        onLeave={() => { window.location.href = '/'; }}
        onRaceAgain={again}
        timeScale={speed}
        startAt={startAt}
      />
      <div style={{ position: 'fixed', left: 12, bottom: 52, zIndex: 20, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => {
            speed.current = speed.current >= 4 ? 1 : speed.current * 2;
            setSpeedLabel(`${speed.current}×`);
          }}
          style={{ background: 'rgba(10,8,18,0.72)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#f5eddf', padding: '6px 10px', fontSize: 12, fontWeight: 700 }}
        >
          {speedLabel}
        </button>
        <span style={{ color: '#6f6790', fontSize: 11 }}>seed {seed} · sim {simMs.toFixed(0)}ms</span>
      </div>
    </>
  );
}
