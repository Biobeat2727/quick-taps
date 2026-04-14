'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarbleRace from '@/components/game/marble-race/MarbleRace';
import type { Session, SessionPlayer } from '@/types/session';

interface Props {
  sessionId: string;
}

export default function RaceRoom({ sessionId }: Props) {
  const router = useRouter();

  const [players, setPlayers] = useState<SessionPlayer[] | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [isProjector, setIsProjector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Detect projector mode
    const proj = new URLSearchParams(window.location.search).has('projector');
    setIsProjector(proj);

    // Read player identity from localStorage (not required for projector)
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

    // Fetch session to get player list
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

  const handleRaceFinished = () => {
    // Only the session creator (players[0]) deletes the session
    if (!isProjector && players[0] && myPlayerId === players[0].id) {
      void fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    }
  };

  return (
    <MarbleRace
      players={players}
      myPlayerId={myPlayerId}
      isProjector={isProjector}
      onLeave={() => router.push('/')}
      onRaceAgain={() => router.push('/')}
      onRaceFinished={handleRaceFinished}
    />
  );
}
