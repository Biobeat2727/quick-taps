'use client';

import { BOARD_LABELS, type BoardGame, type BoardRow } from './useLeaderboard';

const MEDALS = ['#ffb424', '#d8d2ea', '#d8894a'];

/** Ranked rows for one game; the viewer's own row is highlighted. */
export function BoardList({ game, rows, me, empty }: { game: BoardGame; rows: BoardRow[]; me: string | null; empty: string }) {
  if (!rows.length) {
    return <p className="py-4 text-center text-sm text-[var(--qt-mute)]">{empty}</p>;
  }
  const mine = me?.trim().toLowerCase();
  return (
    <ol className="space-y-1">
      {rows.map((r, i) => {
        const isMe = r.name.trim().toLowerCase() === mine;
        return (
          <li
            key={`${r.name}-${i}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{ background: isMe ? 'rgba(255,180,36,0.14)' : 'transparent' }}
          >
            <span
              className="font-display w-6 text-center text-[15px]"
              style={{ color: MEDALS[i] ?? 'var(--qt-mute)', textShadow: i < 3 ? `0 0 10px ${MEDALS[i]}` : undefined }}
            >
              {i + 1}
            </span>
            <span className={`flex-1 truncate text-[15px] ${isMe ? 'text-[var(--qt-amber)] font-bold' : 'text-[var(--qt-cream)]'}`}>
              {r.name}
            </span>
            <span className="font-display text-[15px] text-[var(--qt-cream)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {BOARD_LABELS[game].unit(r.value)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
