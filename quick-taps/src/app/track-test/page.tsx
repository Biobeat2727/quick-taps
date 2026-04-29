'use client';

import { useMemo } from 'react';
import MarbleRaceScene from '@/components/game/marble-race/MarbleRaceScene';
import type { DecodedRecording } from '@/types/race';

const MOCK_PLAYERS = [
  { id: 'test-player', name: 'You', color: '#E24B4A', isNpc: false },
  { id: 'npc-1', name: 'Roxy', color: '#4A9FE2', isNpc: true },
  { id: 'npc-2', name: 'Bounce', color: '#6DBF5B', isNpc: true },
];

/**
 * Generates a fake recording for the dev sandbox by dropping marbles straight
 * through the track. Good enough to test rendering/camera without running the
 * real server-side simulation.
 */
function makeMockRecording(playerCount: number): DecodedRecording {
  const numFrames = 2400; // 40 s @ 60 Hz
  const frames = new Float32Array(numFrames * playerCount * 3);
  for (let f = 0; f < numFrames; f++) {
    for (let i = 0; i < playerCount; i++) {
      const off = (f * playerCount + i) * 3;
      const t = f / numFrames;
      // Spread marbles across x, advance z at different speeds
      const speed = 0.85 + i * 0.08;
      frames[off]     = -8 + i * (16 / Math.max(playerCount - 1, 1));
      frames[off + 1] = Math.sin(f * 0.1 + i) * 2;
      frames[off + 2] = -10 + t * speed * 275;
    }
  }
  const ranking = MOCK_PLAYERS.map(p => p.id).reverse();
  return { numMarbles: playerCount, numFrames, frames, ranking };
}

export default function TrackTestPage() {
  const recording = useMemo(() => makeMockRecording(MOCK_PLAYERS.length), []);

  return (
    <MarbleRaceScene
      players={MOCK_PLAYERS}
      myPlayerId="test-player"
      recording={recording}
      onLeave={() => {}}
      onRaceAgain={() => {}}
    />
  );
}
