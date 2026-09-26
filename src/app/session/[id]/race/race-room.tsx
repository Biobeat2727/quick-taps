'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Ably from 'ably';
import MapRaceScene, { type MapRecording } from '@/components/game/marble-race/MapRaceScene';
import { getMap } from '@/lib/marble/maps';
import type { Session, SessionPlayer } from '@/types/session';
import type { RaceRecording } from '@/types/race';
import { useActivity } from '@/components/presence/PresenceProvider';
import { getBrowserId } from '@/lib/browser-id';

interface Props {
  sessionId: string;
}

interface Decoded {
  map: string;
  marbles: RaceRecording['marbles'];
  recording: MapRecording;
}

function decodeRecording(raw: RaceRecording): Decoded {
  const binaryStr = atob(raw.framesBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return {
    map: raw.map,
    marbles: raw.marbles,
    recording: {
      numMarbles:  raw.numMarbles,
      numFrames:   raw.numFrames,
      frames:      new Float32Array(bytes.buffer),
      finishFrame: raw.finishFrame,
      ranking:     raw.ranking,
    },
  };
}

export default function RaceRoom({ sessionId }: Props) {
  const router = useRouter();
  useActivity('playing', 'marble_race');

  const [players,   setPlayers]   = useState<SessionPlayer[] | null>(null);
  const [race, setRace] = useState<Decoded | null>(null);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [isProjector, setIsProjector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rematch, setRematch] = useState<'none' | 'requested' | 'waiting'>('none');

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

      fetch(`/api/sessions/${sessionId}/recording`).then(async res => {
        if (!res.ok) { setError('Race recording not found.'); return; }
        const raw = (await res.json()) as RaceRecording;
        setRace(decodeRecording(raw));
      }),
    ]).catch(() => setError('Failed to load race data.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Subscribe for the rematch: when the host restarts, game:started carries a
  // fresh seed and every client (including the projector) jumps to the new race.
  useEffect(() => {
    let clientId = '';
    try {
      const raw = localStorage.getItem(`qt:player:${sessionId}`);
      clientId = raw ? (JSON.parse(raw) as { playerId: string }).playerId : '';
    } catch { /* fall through to browserId */ }
    if (!clientId) clientId = getBrowserId();

    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(clientId)}&sessionId=${encodeURIComponent(sessionId)}`,
    });
    const channel = client.channels.get(`qt:session:${sessionId}`);
    // .catch: attach rejects with "Connection closed" if we unmount (e.g. the
    // rematch remount) before the connection finishes establishing
    channel
      .subscribe('game:started', (msg) => {
        const { seed: newSeed } = msg.data as { seed: number };
        const proj = new URLSearchParams(window.location.search).has('projector') ? '&projector=true' : '';
        router.push(`/session/${sessionId}/race?seed=${newSeed}${proj}`);
      })
      .catch(() => {});
    return () => {
      channel.unsubscribe();
      client.close();
    };
  }, [sessionId, router]);

  // Keep the session alive while people sit on the results screen
  useEffect(() => {
    const interval = setInterval(() => {
      void fetch(`/api/sessions/${sessionId}/heartbeat`, { method: 'PATCH' });
    }, 60_000);
    return () => clearInterval(interval);
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

  const ready = players && race;

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

  // The session survives the race — it's only deleted when the last human
  // leaves (the leave route handles that).
  const handleRaceFinished = () => {};

  const isHost = !isProjector && !!players![0] && myPlayerId === players![0].id;

  const handleLeave = () => {
    if (!isProjector && myPlayerId) {
      void fetch(`/api/sessions/${sessionId}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: myPlayerId }),
      });
    }
    router.push('/');
  };

  const handleRaceAgain = () => {
    if (!isHost) {
      // Non-hosts can't restart; game:started will pull them in when the host does
      setRematch('waiting');
      return;
    }
    setRematch('requested');
    void fetch(`/api/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayerId }),
    }).then((res) => {
      if (!res.ok) setRematch('none');
      // On success, game:started drives navigation for everyone
    }).catch(() => setRematch('none'));
  };

  const rematchOverlay = rematch !== 'none' && (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, background: 'rgba(12,10,20,0.9)',
      }}
    >
      <span className="neon-sign" style={{ fontSize: 26 }}>
        {rematch === 'requested' ? 'Rematch starting…' : 'Waiting for the host…'}
      </span>
      {rematch === 'waiting' && (
        <button
          onClick={handleLeave}
          style={{
            padding: '12px 28px', borderRadius: 14,
            background: 'var(--qt-panel-2, #1F1930)', color: 'var(--qt-cream, #F5EDDF)',
            border: '1px solid var(--qt-line, #2A2338)', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Leave instead
        </button>
      )}
    </div>
  );

  return (
    <>
      <MapRaceScene
        map={getMap(race!.map)}
        participants={race!.marbles}
        myPlayerId={myPlayerId}
        isProjector={isProjector}
        recording={race!.recording}
        onLeave={handleLeave}
        onRaceAgain={handleRaceAgain}
        onRaceFinished={handleRaceFinished}
      />
      {rematchOverlay}
    </>
  );
}
