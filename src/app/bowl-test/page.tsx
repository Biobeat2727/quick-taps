'use client';

import { useState, useRef } from 'react';
import { BowlingScene } from '@/components/game/bowling/BowlingScene';
import {
  decodeRecording,
  computeFrameScores,
  nextTurn,
  isGameComplete,
  ScoreCard,
  BowlingResultsScreen,
  type BowlingPhase,
  type BowlingGameState,
} from '@/components/game/bowling/bowling-shared';
import type { ThrowParams, BowlingDecodedRecording } from '@/types/bowling';

const PLAYER_ID = 'test-player';
const PLAYER_IDS = [PLAYER_ID];

function initialState(): BowlingGameState {
  return {
    currentFrame: 0,
    currentThrow: 1,
    activePlayerId: PLAYER_ID,
    pinState: Array(10).fill(true),
    throwHistory: { [PLAYER_ID]: Array.from({ length: 10 }, () => [] as number[]) },
  };
}

export default function BowlTestPage() {
  const [gameState, setGameState] = useState<BowlingGameState>(initialState);
  const [recording, setRecording] = useState<BowlingDecodedRecording | null>(null);
  const [phase, setPhase] = useState<BowlingPhase>('aiming');
  // Keep a stable ref to gameState for use inside the timeout callback
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const frames = gameState.throwHistory[PLAYER_ID] ?? [];
  const cumScores = computeFrameScores(frames.flat());

  async function handleThrow(params: ThrowParams) {
    setPhase('replay');
    const res = await fetch('/api/bowl-test/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const raw = await res.json();
    setRecording(decodeRecording(raw));
  }

  function handleReplayComplete(knockedPins: boolean[]) {
    const current = gameStateRef.current;
    const newState = nextTurn(current, knockedPins, PLAYER_IDS);
    const gameOver = isGameComplete(newState, PLAYER_IDS);
    const frameAdvanced = newState.currentFrame > current.currentFrame;

    // Delay before UI reset when: frame complete, game over, or 10th-frame mid-frame pin reset
    const within10thReset =
      !gameOver &&
      !frameAdvanced &&
      current.currentFrame === 9 &&
      newState.pinState.every(Boolean);

    const needsDelay = gameOver || frameAdvanced || within10thReset;

    if (needsDelay) {
      setTimeout(() => {
        setGameState(newState);
        setRecording(null);
        setPhase(gameOver ? 'results' : 'aiming');
      }, 2500);
    } else {
      setGameState(newState);
      setRecording(null);
      setPhase('aiming');
    }
  }

  if (phase === 'results') {
    return (
      <BowlingResultsScreen
        players={[{ id: PLAYER_ID, name: 'You' }]}
        throwHistory={gameState.throwHistory}
        onBowlAgain={() => {
          setGameState(initialState());
          setRecording(null);
          setPhase('aiming');
        }}
        onLeave={() => window.history.back()}
      />
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-gray-950 relative">
      <BowlingScene
        myPlayerId={PLAYER_ID}
        pinState={gameState.pinState}
        recording={recording}
        phase={phase}
        isMyTurn={true}
        onThrow={handleThrow}
        onReplayComplete={handleReplayComplete}
      />

      {/* ScoreCard overlay */}
      <div
        style={{
          position: 'absolute', top: 8, left: 8, right: 8,
          background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '6px 8px',
        }}
      >
        <ScoreCard
          playerName="You"
          frameThrows={frames}
          activeFrame={gameState.currentFrame}
          cumScores={cumScores}
        />
      </div>
    </div>
  );
}
