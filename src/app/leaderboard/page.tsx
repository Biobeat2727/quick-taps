'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { BoardList } from '@/components/leaderboard/BoardList';
import { BOARD_LABELS, myName, useLeaderboard, type BoardGame } from '@/components/leaderboard/useLeaderboard';

const GAMES: BoardGame[] = ['bowling', 'pool', 'marble_race'];
const SUB: Record<BoardGame, string> = {
  bowling: 'Best single game',
  pool: 'Wins vs other players',
  marble_race: 'Wins vs other players',
};
const noSubscribe = () => () => {};

export default function LeaderboardPage() {
  const name = useSyncExternalStore(noSubscribe, myName, () => null);
  const { data, failed } = useLeaderboard(name, 20_000);

  return (
    <main className="flex flex-col w-full max-w-md mx-auto px-4 pb-8" style={{ minHeight: '100dvh' }}>
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="text-[12px] tracking-[0.2em] uppercase text-[var(--qt-mute)]">← Back</Link>
        <h1 className="neon-sign text-xl leading-none">Tonight</h1>
        <span className="w-12" />
      </header>
      {failed && !data && (
        <p className="text-center text-sm text-[var(--qt-mute)] py-8">The board is taking a break. Try again in a minute.</p>
      )}
      {!data && !failed && <p className="text-center text-sm text-[var(--qt-mute)] py-8 animate-pulse">Loading…</p>}
      {data && (
        <div className="space-y-4">
          {GAMES.map((g) => (
            <section key={g} className="rounded-2xl bg-[var(--qt-panel)] border border-[var(--qt-line)] px-3 py-3">
              <div className="flex items-baseline justify-between px-1 mb-2">
                <h2 className="font-display text-[17px] text-[var(--qt-amber)]">{BOARD_LABELS[g].title}</h2>
                <span className="text-[11px] tracking-[0.2em] uppercase text-[var(--qt-mute)]">{SUB[g]}</span>
              </div>
              <BoardList game={g} rows={data.games[g]} me={name} empty="Nobody on the board yet tonight." />
            </section>
          ))}
          <p className="text-center text-[11px] text-[var(--qt-mute)]">Boards reset at 4 AM.</p>
        </div>
      )}
    </main>
  );
}
