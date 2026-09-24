'use client';

import { useRef, useState, useEffect } from 'react';
import { PoolScene } from '@/components/game/pool/PoolScene';
import { decodeRecording, PoolResultsScreen, PoolStatusBar } from '@/components/game/pool/pool-shared';
import type { PoolPhase } from '@/components/game/pool/pool-shared';
import type {
  PoolDecodedRecording,
  PoolGameState,
  PoolRawRecording,
  PoolShotParams,
  PoolShotResult,
} from '@/types/pool';
import type { SessionPlayer } from '@/types/session';
import { processShot } from '@/lib/pool/pool-logic';
import { TABLE_HALF_WIDTH, TABLE_HALF_LENGTH, BALL_RADIUS } from '@/lib/pool/pool-constants';

const ZOOM = 280;

const PLAYERS: SessionPlayer[] = [
  { id: 'player-a', name: 'Player A', color: '#4ade80', isNpc: false },
  { id: 'player-b', name: 'Player B', color: '#60a5fa', isNpc: false },
];
const PLAYER_IDS = PLAYERS.map(p => p.id);
const MY_PLAYER_ID = 'player-a';

function makeInitialGameState(): PoolGameState {
  return {
    activePlayerId: 'player-a',
    activeBalls: Array(16).fill(true) as boolean[],
    playerGroups: {},
    groupAssigned: false,
    shotCount: 0,
    ballInHand: false,
    cueBallPos: [0, -0.686],
    winner: null,
    gameOver: false,
  };
}

export default function PoolTestPage() {
  const [gameState, setGameState] = useState<PoolGameState>(makeInitialGameState());
  const [phase, setPhase] = useState<PoolPhase>('aiming');
  const [recording, setRecording] = useState<PoolDecodedRecording | null>(null);
  const [isPlacingCueBall, setIsPlacingCueBall] = useState(false);
  const recordingRef = useRef<PoolDecodedRecording | null>(null);

  // Enter ball-in-hand placement mode when gameState.ballInHand is set
  useEffect(() => {
    if (gameState.ballInHand) {
      setIsPlacingCueBall(true);
    }
  }, [gameState.ballInHand]);

  async function handleShoot(aimParams: Pick<PoolShotParams, 'angle' | 'power'>) {
    setPhase('shooting');
    const params: PoolShotParams = {
      ...aimParams,
      cueBallX: gameState.cueBallPos[0],
      cueBallZ: gameState.cueBallPos[1],
      activeBalls: gameState.activeBalls,
    };
    const res = await fetch('/api/pool-test/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const raw: PoolRawRecording = await res.json();
    const decoded = decodeRecording(raw);
    recordingRef.current = decoded;
    setRecording(decoded);
    setPhase('replay');
  }

  function handleReplayComplete(result: PoolShotResult) {
    const rec = recordingRef.current;

    // Update cue ball position from last replay frame (unless scratched)
    let newCueBallPos = gameState.cueBallPos;
    if (!result.cueBallPocketed && rec) {
      const lastF = rec.numFrames - 1;
      const cx = rec.ballFrames[(lastF * 16 + 0) * 2];
      const cz = rec.ballFrames[(lastF * 16 + 0) * 2 + 1];
      newCueBallPos = [cx, cz];
    }

    const stateWithPos: PoolGameState = { ...gameState, cueBallPos: newCueBallPos as [number, number] };
    const newState = processShot(stateWithPos, result, PLAYER_IDS);

    setGameState(newState);
    setRecording(null);
    recordingRef.current = null;

    if (newState.gameOver) {
      setPhase('results');
    } else {
      setPhase('aiming');
    }
  }

  // Convert a click on the overlay to table coordinates and update cue ball position
  function handleTableClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const worldX = (cx - rect.width / 2) / ZOOM;
    const worldZ = -(cy - rect.height / 2) / ZOOM;
    // Clamp to kitchen (Z < 0) and within table bounds
    const clampedX = Math.max(-TABLE_HALF_WIDTH + BALL_RADIUS, Math.min(TABLE_HALF_WIDTH - BALL_RADIUS, worldX));
    const clampedZ = Math.max(-TABLE_HALF_LENGTH + BALL_RADIUS, Math.min(-BALL_RADIUS, worldZ));
    setGameState(gs => ({ ...gs, cueBallPos: [clampedX, clampedZ] as [number, number] }));
  }

  function confirmPlacement() {
    setIsPlacingCueBall(false);
    setGameState(gs => ({ ...gs, ballInHand: false }));
  }

  function handlePlayAgain() {
    setGameState(makeInitialGameState());
    setPhase('aiming');
    setRecording(null);
    recordingRef.current = null;
    setIsPlacingCueBall(false);
  }

  if (phase === 'results') {
    return (
      <PoolResultsScreen
        gameState={gameState}
        players={PLAYERS}
        onPlayAgain={handlePlayAgain}
        onLeave={() => {}}
      />
    );
  }

  return (
    <div className="w-full bg-gray-950 relative" style={{ height: '100dvh' }}>
      {/* Status bar overlay */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}>
        <PoolStatusBar gameState={gameState} players={PLAYERS} myPlayerId={MY_PLAYER_ID} />
      </div>

      {/* Scene fills full height (status bar overlaps it) */}
      <PoolScene
        myPlayerId={MY_PLAYER_ID}
        gameState={gameState}
        recording={recording}
        onShoot={handleShoot}
        onReplayComplete={handleReplayComplete}
        phase={phase}
        isMyTurn={!isPlacingCueBall}
        players={PLAYERS}
      />

      {/* Ball-in-hand placement overlay */}
      {isPlacingCueBall && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'crosshair',
            zIndex: 15,
          }}
          onClick={handleTableClick}
        >
          {/* Instruction + confirm button — stop propagation so clicks here don't move the ball */}
          <div
            style={{
              position: 'absolute',
              bottom: 32,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
            onClick={e => e.stopPropagation()}
          >
            <span
              style={{
                color: '#f59e0b',
                fontFamily: 'system-ui, sans-serif',
                fontSize: 14,
                fontWeight: 700,
                background: 'rgba(0,0,0,0.7)',
                padding: '6px 14px',
                borderRadius: 6,
              }}
            >
              Ball in hand — click table to place (kitchen only)
            </span>
            <button
              onClick={confirmPlacement}
              style={{
                background: '#4ade80',
                color: '#0d1a0d',
                border: 'none',
                borderRadius: 8,
                padding: '10px 28px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Confirm placement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
