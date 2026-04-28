'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarbleRace from '@/components/game/marble-race/MarbleRace';
import MarbleRaceScene from '@/components/game/marble-race/MarbleRaceScene';
import type { Session, SessionPlayer } from '@/types/session';

type Mode = '2d' | '3d';

interface Props {
  sessionId: string;
}

function ModePicker({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return (
    <main
      style={{
        minHeight: '100dvh', background: '#1C1B16', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 24,
        fontFamily: 'system-ui, sans-serif', padding: '32px 16px',
      }}
    >
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#EF9F27', margin: 0 }}>
        Choose View
      </h2>
      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 320 }}>
        <button
          onClick={() => onSelect('2d')}
          style={{
            flex: 1, padding: '20px 0', borderRadius: 16,
            background: '#EF9F27', color: '#1C1B16',
            fontWeight: 700, fontSize: 16, border: 'none', cursor: 'pointer',
          }}
        >
          2D Classic
        </button>
        <button
          onClick={() => onSelect('3d')}
          style={{
            flex: 1, padding: '20px 0', borderRadius: 16,
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            fontWeight: 700, fontSize: 16, border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer',
          }}
        >
          3D
        </button>
      </div>
    </main>
  );
}

export default function RaceRoom({ sessionId }: Props) {
  const router = useRouter();

  const [players, setPlayers] = useState<SessionPlayer[] | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [isProjector, setIsProjector] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const proj = new URLSearchParams(window.location.search).has('projector');
    setIsProjector(proj);

    let pid = '';
    if (!proj) {
      try {
        const raw = localStorage.getItem(`qt:player:${sessionId}`);
        const info = raw ? (JSON.parse(raw) as { playerId: string }) : null;
        if (!info?.playerId) {
          router.replace('/');
          return;
        }
        pid = info.playerId;
        setMyPlayerId(pid);
      } catch {
        router.replace('/');
        return;
      }
    }

    void fetch(`/api/sessions/${sessionId}`)
      .then(async res => {
        if (!res.ok) {
          if (res.status === 404) { router.replace('/'); return; }
          setError('Failed to load race data.');
          return;
        }
        const session = (await res.json()) as Session;
        setPlayers(session.players);
      })
      .catch(() => setError('Failed to load race data.'));
  }, [sessionId, router]);

  if (error) {
    return (
      <main
        style={{
          display: 'flex', minHeight: '100dvh', alignItems: 'center',
          justifyContent: 'center', background: '#1C1B16', color: '#E24B4A',
          fontFamily: 'system-ui, sans-serif', fontSize: 16,
        }}
      >
        {error}
      </main>
    );
  }

  if (!players) {
    return (
      <main
        style={{
          display: 'flex', minHeight: '100dvh', alignItems: 'center',
          justifyContent: 'center', background: '#1C1B16',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ color: '#EF9F27', fontSize: 16 }}>Loading race…</span>
      </main>
    );
  }

  if (mode === null) {
    return <ModePicker onSelect={setMode} />;
  }

  const handleRaceFinished = () => {
    if (!isProjector && players[0] && myPlayerId === players[0].id) {
      void fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    }
  };

  const sharedProps = {
    players,
    myPlayerId,
    isProjector,
    onLeave: () => router.push('/'),
    onRaceAgain: () => router.push('/'),
    onRaceFinished: handleRaceFinished,
  };

  return mode === '3d'
    ? <MarbleRaceScene {...sharedProps} />
    : <MarbleRace {...sharedProps} />;
}
