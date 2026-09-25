'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMatch } from '@/lib/match/useMatch';
import { PoolGame } from '@/components/game/pool-v2/PoolLab';
import type { PoolMatch } from '@/types/match';

export default function PoolRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { meId, match, error, net, deadline } = useMatch<PoolMatch>(sessionId);
  // Only hand the game new "truth" when the match object itself changes (a reload)
  const sync = useMemo(() => (match ? { seq: match.seq, state: match.state, force: !!match.resync } : undefined), [match]);

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
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#06040b' }}>
        <p className="font-display text-xl" style={{ color: '#fff3d6' }}>{error}</p>
        <button className="btn-amber rounded-2xl px-6 py-3 font-bold uppercase" onClick={() => router.push(`/session/${sessionId}`)}>Back to the table</button>
      </main>
    );
  }
  if (!match || !meId) {
    return (
      <main className="fixed inset-0 flex items-center justify-center" style={{ background: '#06040b' }}>
        <span className="font-display text-lg animate-pulse" style={{ color: '#9bf6ff' }}>Racking up…</span>
      </main>
    );
  }
  return (
    <PoolGame
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
