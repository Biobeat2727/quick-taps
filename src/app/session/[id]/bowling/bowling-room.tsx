'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMatch } from '@/lib/match/useMatch';
import { BowlGame } from '@/components/game/bowling-v2/BowlLab';
import type { BowlingMatch } from '@/types/match';
import { useActivity } from '@/components/presence/PresenceProvider';

export default function BowlingRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  useActivity('playing', 'bowling');
  const { meId, match, error, net, deadline } = useMatch<BowlingMatch>(sessionId);
  // Only hand the game new "truth" when the match object itself changes (a reload)
  const sync = useMemo(() => (match ? { seq: match.seq, state: match.state, players: match.players, force: !!match.resync } : undefined), [match]);

  const leave = async () => {
    if (meId) {
      await fetch(`/api/sessions/${sessionId}/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: meId }),
      });
    }
    router.push('/');
  };

  if (error) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#07040c' }}>
        <p className="font-display text-xl" style={{ color: '#fff3d6' }}>{error}</p>
        <button className="btn-amber rounded-2xl px-6 py-3 font-bold uppercase" onClick={() => router.push(`/session/${sessionId}`)}>Back to the lane</button>
      </main>
    );
  }
  if (!match || !meId) {
    return (
      <main className="fixed inset-0 flex items-center justify-center" style={{ background: '#07040c' }}>
        <span className="font-display text-lg animate-pulse" style={{ color: '#ff9ae8' }}>Racking pins…</span>
      </main>
    );
  }
  return (
    <BowlGame
      key={match.startedAt}
      players={match.players}
      meId={meId}
      hostId={match.hostId}
      initial={match.state}
      initialSeq={match.seq}
      net={net}
      sync={sync}
      deadline={deadline}
      onLeave={() => void leave()}
    />
  );
}
