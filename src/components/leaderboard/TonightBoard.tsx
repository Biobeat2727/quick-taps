'use client';

// Home-screen card: tonight's top 5 per game, one tab each.

import Link from 'next/link';
import { useState } from 'react';
import { BoardList } from './BoardList';
import { BOARD_LABELS, useLeaderboard, type BoardGame } from './useLeaderboard';

const TABS: BoardGame[] = ['bowling', 'pool', 'marble_race'];
const EMPTY: Record<BoardGame, string> = {
  bowling: 'No games bowled yet tonight.',
  pool: 'No pool wins yet tonight. Beat someone at the table.',
  marble_race: 'No race wins yet tonight. Race someone.',
};

export function TonightBoard({ name }: { name: string | null }) {
  const { data, failed } = useLeaderboard(name);
  const [tab, setTab] = useState<BoardGame>('bowling');
  if (failed && !data) return null; // the board is a bonus; never block the home screen

  return (
    <section className="rounded-2xl bg-[var(--qt-panel)] border border-[var(--qt-line)] px-3 pt-3 pb-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">Tonight&apos;s leaders</h2>
        <Link href="/leaderboard" className="text-[11px] tracking-[0.2em] uppercase text-[var(--qt-ice)]">Full board</Link>
      </div>
      <div className="flex gap-1 mb-2" role="tablist">
        {TABS.map((g) => (
          <button
            key={g}
            role="tab"
            aria-selected={tab === g}
            onClick={() => setTab(g)}
            className="flex-1 rounded-lg py-1.5 text-[12px] font-bold uppercase tracking-wide"
            style={{
              background: tab === g ? 'var(--qt-panel-2)' : 'transparent',
              color: tab === g ? 'var(--qt-amber)' : 'var(--qt-mute)',
              border: `1px solid ${tab === g ? 'var(--qt-line)' : 'transparent'}`,
            }}
          >
            {BOARD_LABELS[g].title}
          </button>
        ))}
      </div>
      {data ? (
        <BoardList game={tab} rows={data.games[tab].slice(0, 5)} me={name} empty={EMPTY[tab]} />
      ) : (
        <p className="py-4 text-center text-sm text-[var(--qt-mute)] animate-pulse">Loading…</p>
      )}
    </section>
  );
}
