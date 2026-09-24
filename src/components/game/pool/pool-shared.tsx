'use client';

import type { PoolRawRecording, PoolDecodedRecording, PoolGameState } from '@/types/pool';
import type { SessionPlayer } from '@/types/session';
import { ballGroup } from '@/lib/pool/pool-constants';

export type PoolPhase = 'aiming' | 'shooting' | 'replay' | 'results';

export function decodeRecording(raw: PoolRawRecording): PoolDecodedRecording {
  const toBinary = (b64: string): ArrayBuffer => {
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
  };

  return {
    numFrames: raw.numFrames,
    ballFrames: new Float32Array(toBinary(raw.ballFramesBase64)),
    pocketedAtFrame: raw.pocketedAtFrame,
    cueBallPocketed: raw.cueBallPocketed,
    finalPocketed: raw.finalPocketed,
  };
}

export function PoolStatusBar({
  gameState,
  players,
  myPlayerId,
}: {
  gameState: PoolGameState;
  players: SessionPlayer[];
  myPlayerId: string;
}) {
  const activePlayer = players.find(p => p.id === gameState.activePlayerId);
  const activeName = activePlayer?.name ?? gameState.activePlayerId;
  const isMyTurn = gameState.activePlayerId === myPlayerId;
  const activeGroup = gameState.playerGroups[gameState.activePlayerId] ?? null;

  let ownBallsLeft = 0;
  if (activeGroup) {
    for (let i = 1; i <= 15; i++) {
      if (i === 8) continue;
      if (gameState.activeBalls[i] && ballGroup(i) === activeGroup) ownBallsLeft++;
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        fontSize: 14,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span style={{ fontWeight: 700, color: isMyTurn ? '#4ade80' : '#60a5fa' }}>
        {isMyTurn ? 'Your turn' : `${activeName}'s turn`}
      </span>

      {gameState.groupAssigned && activeGroup ? (
        <span style={{ color: '#bbb' }}>
          {activeGroup === 'solid' ? 'Solids' : 'Stripes'} — {ownBallsLeft} left
          {ownBallsLeft === 0 ? ' · pocket the 8!' : ''}
        </span>
      ) : (
        <span style={{ color: '#888' }}>Open table</span>
      )}

      {gameState.ballInHand && (
        <span style={{ color: '#f59e0b', fontWeight: 700, marginLeft: 4 }}>
          · Ball in hand
        </span>
      )}
    </div>
  );
}

export function PoolResultsScreen({
  gameState,
  players,
  onPlayAgain,
  onLeave,
}: {
  gameState: PoolGameState;
  players: SessionPlayer[];
  onPlayAgain: () => void;
  onLeave: () => void;
}) {
  const winner = players.find(p => p.id === gameState.winner);

  return (
    <main
      style={{
        minHeight: '100dvh', background: '#0d1a0d', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '32px 16px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 900, color: '#4ade80', margin: '0 0 12px' }}>
        {winner ? `${winner.name} wins!` : 'Game Over!'}
      </h1>

      <div style={{ marginTop: 40, display: 'flex', gap: 12 }}>
        <button
          onClick={onPlayAgain}
          style={{
            background: '#4ade80', color: '#0d1a0d', border: 'none',
            borderRadius: 8, padding: '12px 24px', fontSize: 16,
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          Play Again
        </button>
        <button
          onClick={onLeave}
          style={{
            background: 'transparent', color: '#aaa', border: '1px solid #555',
            borderRadius: 8, padding: '12px 24px', fontSize: 16, cursor: 'pointer',
          }}
        >
          Leave
        </button>
      </div>
    </main>
  );
}
