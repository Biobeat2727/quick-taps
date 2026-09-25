'use client';

// End-of-game badge: where this result puts you on tonight's board. The score
// is written just after the game ends, so it retries until the board reflects
// it (`atLeast`: this game's value — otherwise an earlier, worse game from
// tonight could be shown as if it were this one).

import { useEffect, useState } from 'react';
import type { BoardData, BoardGame } from './useLeaderboard';

export function TonightRank({ game, name, enabled = true, atLeast = 1 }: {
  game: BoardGame; name: string | null | undefined; enabled?: boolean; atLeast?: number;
}) {
  const [mine, setMine] = useState<{ rank: number; value: number } | null>(null);

  useEffect(() => {
    if (!enabled || !name) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryLoad = async (attempt: number) => {
      try {
        const res = await fetch(`/api/leaderboard?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        const d = (await res.json()) as BoardData;
        const m = d.me?.[game];
        if (m && m.value >= atLeast && !cancelled) { setMine(m); return; }
      } catch { /* try again */ }
      if (attempt < 4 && !cancelled) timers.push(setTimeout(() => void tryLoad(attempt + 1), 1_200 * (attempt + 1)));
    };
    timers.push(setTimeout(() => void tryLoad(0), 1_200));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [game, name, enabled, atLeast]);

  if (!mine) return null;
  const top = mine.rank === 1;
  const text = game === 'bowling'
    ? (top ? 'High score of the night!' : `#${mine.rank} tonight`)
    : `${mine.value} ${mine.value === 1 ? 'win' : 'wins'} tonight · #${mine.rank}`;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-bold uppercase tracking-wide"
      style={{
        background: top ? 'rgba(255,180,36,0.18)' : 'rgba(10,8,18,0.72)',
        border: `1px solid ${top ? '#ffb424' : 'rgba(255,255,255,0.15)'}`,
        color: top ? '#ffd27a' : '#f5eddf',
        boxShadow: top ? '0 0 18px rgba(255,180,36,0.45)' : undefined,
        animation: 'tonightIn .6s cubic-bezier(.2,1.4,.3,1) both',
      }}
    >
      <span aria-hidden>{top ? '★' : '▲'}</span>
      {text}
      <style>{`@keyframes tonightIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
