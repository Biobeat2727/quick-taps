'use client';

import MarbleRaceScene from '@/components/game/marble-race/MarbleRaceScene';

const MOCK_PLAYERS = [
  { id: 'test-player', name: 'You', color: '#E24B4A', isNpc: false },
];

export default function TrackTestPage() {
  return (
    <MarbleRaceScene
      players={MOCK_PLAYERS}
      myPlayerId="test-player"
      onLeave={() => {}}
      onRaceAgain={() => {}}
    />
  );
}
