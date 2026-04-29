'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarbleRace from '@/components/game/marble-race/MarbleRace';
import MarbleRaceScene from '@/components/game/marble-race/MarbleRaceScene';
import type { Session, SessionPlayer } from '@/types/session';
import type { DecodedRecording, RaceRecording } from '@/types/race';

type Mode = '2d' | '3d';

interface Props {
  sessionId: string;
  mode: Mode;
  seed: number;
}

function decodeRecording(raw: RaceRecording): DecodedRecording {
  const binaryStr = atob(raw.framesBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return {
    numMarbles: raw.numMarbles,
    numFrames:  raw.numFrames,
    frames:     new Float32Array(bytes.buffer),
    ranking:    raw.ranking,
  };
}

export default function RaceRoom({ sessionId, mode, seed }: Props) {
  const router = useRouter();

  const [players,   setPlayers]   = useState<SessionPlayer[] | null>(null);
  const [recording, setRecording] = useState<DecodedRecording | null>(null);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [isProjector, setIsProjector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const proj = new URLSearchParams(window.location.search).has('projector');
    setIsProjector(proj);

    let pid = '';
    if (!proj) {
      try {
        const raw = localStorage.getItem(`qt:player:${sessionId}`);
        const info = raw ? (JSON.parse(raw) as { playerId: string }) : null;
        if (!info?.playerId) { router.replace('/'); return; }
        pid = info.playerId;
        setMyPlayerId(pid);
      } catch {
        router.replace('/');
        return;
      }
    }

    // Fetch session players and recording in parallel
    void Promise.all([
      fetch(`/api/sessions/${sessionId}`).then(async res => {
        if (!res.ok) {
          if (res.status === 404) { router.replace('/'); return; }
          setError('Failed to load race data.');
          return;
        }
        const session = (await res.json()) as Session;
        setPlayers(session.players);
      }),

      mode === '3d'
        ? fetch(`/api/sessions/${sessionId}/recording`).then(async res => {
            if (!res.ok) { setError('Race recording not found.'); return; }
            const raw = (await res.json()) as RaceRecording;
            setRecording(decodeRecording(raw));
          })
        : Promise.resolve(),   // 2D mode doesn't use a recording
    ]).catch(() => setError('Failed to load race data.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (error) {
    return (
      <main style={{
        display: 'flex', minHeight: '100dvh', alignItems: 'center',
        justifyContent: 'center', background: '#1C1B16', color: '#E24B4A',
        fontFamily: 'system-ui, sans-serif', fontSize: 16,
      }}>
        {error}
      </main>
    );
  }

  // For 3D mode wait for both players and recording; for 2D just players
  const ready = mode === '3d' ? (players && recording) : players;

  if (!ready) {
    return (
      <main style={{
        display: 'flex', minHeight: '100dvh', alignItems: 'center',
        justifyContent: 'center', background: '#1C1B16',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <span style={{ color: '#EF9F27', fontSize: 16 }}>Loading race…</span>
      </main>
    );
  }

  const handleRaceFinished = () => {
    if (!isProjector && players![0] && myPlayerId === players![0].id) {
      void fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    }
  };

  if (mode === '3d') {
    return (
      <MarbleRaceScene
        players={players!}
        myPlayerId={myPlayerId}
        isProjector={isProjector}
        seed={seed}
        recording={recording!}
        onLeave={() => router.push('/')}
        onRaceAgain={() => router.push('/')}
        onRaceFinished={handleRaceFinished}
      />
    );
  }

  return (
    <MarbleRace
      players={players!}
      myPlayerId={myPlayerId}
      isProjector={isProjector}
      seed={seed}
      onLeave={() => router.push('/')}
      onRaceAgain={() => router.push('/')}
      onRaceFinished={handleRaceFinished}
    />
  );
}
