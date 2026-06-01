'use client';

import { useState, useRef } from 'react';
import { BowlingScene } from '@/components/game/bowling/BowlingScene';
import { decodeRecording } from '@/components/game/bowling/bowling-shared';
import type { BowlingPhase } from '@/components/game/bowling/bowling-shared';
import type { ThrowParams, BowlingDecodedRecording } from '@/types/bowling';

export default function BowlTestPage() {
  const [pinState, setPinState] = useState<boolean[]>(Array(10).fill(true));
  const [recording, setRecording] = useState<BowlingDecodedRecording | null>(null);
  const [phase, setPhase] = useState<BowlingPhase>('aiming');
  const throwCount = useRef(0);

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
    throwCount.current++;
    const newPins = pinState.map((standing, i) => standing && !knockedPins[i]);
    const isStrike = knockedPins.every(Boolean) && throwCount.current === 1;

    if (isStrike || throwCount.current >= 2) {
      // Reset after brief pause to show result
      setTimeout(() => {
        setPinState(Array(10).fill(true));
        setRecording(null);
        setPhase('aiming');
        throwCount.current = 0;
      }, 2500);
    } else {
      setPinState(newPins);
      setRecording(null);
      setPhase('aiming');
    }
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-gray-950">
      <BowlingScene
        myPlayerId="test-player"
        pinState={pinState}
        recording={recording}
        phase={phase}
        isMyTurn={true}
        onThrow={handleThrow}
        onReplayComplete={handleReplayComplete}
      />
    </div>
  );
}
