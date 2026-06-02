'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Ably from 'ably';
import { BowlingScene } from '@/components/game/bowling/BowlingScene';
import {
  decodeRecording,
  computeFrameScores,
  ScoreCard,
  BowlingResultsScreen,
  type BowlingPhase,
} from '@/components/game/bowling/bowling-shared';
import { isGameComplete } from '@/lib/bowling/bowling-logic';
import type { Session, SessionPlayer } from '@/types/session';
import type { ThrowParams, BowlingDecodedRecording, BowlingGameState, BowlingRawRecording } from '@/types/bowling';

export default function BowlingRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const [players,   setPlayers]   = useState<SessionPlayer[] | null>(null);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [gameState, setGameState] = useState<BowlingGameState | null>(null);
  const [recording, setRecording] = useState<BowlingDecodedRecording | null>(null);
  const [phase,     setPhase]     = useState<BowlingPhase>('aiming');
  const [error,     setError]     = useState<string | null>(null);

  // Refs for use inside callbacks without stale closure
  const pendingStateRef = useRef<BowlingGameState | null>(null);
  const gameStateRef    = useRef<BowlingGameState | null>(null);
  const playerIdsRef    = useRef<string[]>([]);
  gameStateRef.current  = gameState;

  // Load session + game state on mount
  useEffect(() => {
    let pid = '';
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

    void Promise.all([
      fetch(`/api/sessions/${sessionId}`).then(async res => {
        if (!res.ok) { if (res.status === 404) { router.replace('/'); return; } throw new Error(); }
        const session = (await res.json()) as Session;
        setPlayers(session.players);
        playerIdsRef.current = session.players.map(p => p.id);
      }),
      fetch(`/api/sessions/${sessionId}/bowl`).then(async res => {
        if (!res.ok) throw new Error('Game state not found');
        const state = (await res.json()) as BowlingGameState;
        setGameState(state);
      }),
    ]).catch(() => setError('Failed to load game data.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Ably subscription
  useEffect(() => {
    if (!myPlayerId) return;
    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(myPlayerId)}&sessionId=${encodeURIComponent(sessionId)}`,
    });
    const channel = client.channels.get(`qt:session:${sessionId}`);
    void channel.subscribe(msg => {
      if (msg.name === 'bowl:throw') {
        const { throwIndex, gameState: newState } = msg.data as {
          playerId: string;
          throwIndex: number;
          knockedPins: boolean[];
          gameState: BowlingGameState;
        };
        pendingStateRef.current = newState;
        setPhase('replay');
        void fetch(`/api/sessions/${sessionId}/bowl/recording?throwIndex=${throwIndex}`)
          .then(res => res.json())
          .then((raw: BowlingRawRecording) => setRecording(decodeRecording(raw)));
      }
    });
    return () => { channel.unsubscribe(); client.close(); };
  }, [myPlayerId, sessionId]);

  const handleThrow = useCallback(async (params: ThrowParams) => {
    setPhase('throwing');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/bowl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: myPlayerId, params }),
      });
      if (!res.ok) {
        setPhase('aiming');
        setError('Failed to submit throw. Try again.');
      }
      // bowl:throw Ably event drives transition to 'replay'
    } catch {
      setPhase('aiming');
      setError('Network error. Try again.');
    }
  }, [sessionId, myPlayerId]);

  const handleReplayComplete = useCallback(() => {
    const newState = pendingStateRef.current;
    if (!newState) return;

    const playerIds = playerIdsRef.current;
    const over = isGameComplete(newState, playerIds);
    const oldState = gameStateRef.current;
    const frameAdvanced = !oldState || newState.currentFrame > oldState.currentFrame;
    const within10thReset =
      !over && !frameAdvanced &&
      newState.currentFrame === 9 &&
      newState.pinState.every(Boolean);
    const needsDelay = over || frameAdvanced || within10thReset;

    if (needsDelay) {
      setTimeout(() => {
        setGameState(newState);
        setRecording(null);
        setPhase(over ? 'results' : 'aiming');
      }, 1200);
    } else {
      setGameState(newState);
      setRecording(null);
      setPhase('aiming');
    }
  }, []);

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

  if (!players || !gameState) {
    return (
      <main style={{
        display: 'flex', minHeight: '100dvh', alignItems: 'center',
        justifyContent: 'center', background: '#1C1B16',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <span style={{ color: '#EF9F27', fontSize: 16 }}>Loading…</span>
      </main>
    );
  }

  if (phase === 'results') {
    return (
      <BowlingResultsScreen
        players={players}
        throwHistory={gameState.throwHistory}
        onBowlAgain={() => router.push(`/session/${sessionId}`)}
        onLeave={() => router.push('/')}
      />
    );
  }

  const isMyTurn = gameState.activePlayerId === myPlayerId;
  const activePlayer = players.find(p => p.id === gameState.activePlayerId);

  return (
    <div className="w-full overflow-hidden bg-gray-950 relative" style={{ height: '100dvh' }}>
      <BowlingScene
        myPlayerId={myPlayerId}
        pinState={gameState.pinState}
        recording={recording}
        phase={phase}
        isMyTurn={isMyTurn}
        onThrow={handleThrow}
        onReplayComplete={handleReplayComplete}
      />

      {/* Score cards overlay */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        background: 'rgba(0,0,0,0.65)', borderRadius: 6, padding: '6px 8px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {players.map(player => {
          const frames = gameState.throwHistory[player.id] ?? [];
          const cumScores = computeFrameScores(frames.flat());
          return (
            <ScoreCard
              key={player.id}
              playerName={`${player.name}${player.id === gameState.activePlayerId ? ' ←' : ''}`}
              frameThrows={frames}
              activeFrame={gameState.currentFrame}
              cumScores={cumScores}
            />
          );
        })}
      </div>

      {/* Whose turn banner (non-active players) */}
      {!isMyTurn && phase === 'aiming' && activePlayer && (
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0,
          textAlign: 'center', color: '#EF9F27',
          fontSize: 15, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          {activePlayer.name}&apos;s turn
        </div>
      )}

      {/* Simulating indicator */}
      {phase === 'throwing' && (
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0,
          textAlign: 'center', color: '#EF9F27',
          fontSize: 14, fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}>
          Simulating…
        </div>
      )}
    </div>
  );
}
