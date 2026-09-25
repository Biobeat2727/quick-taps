'use client';

import { useCallback, useEffect, useState } from 'react';

export type BoardGame = 'bowling' | 'pool' | 'marble_race';
export interface BoardRow { name: string; value: number }
export interface BoardData {
  night: string;
  games: Record<BoardGame, BoardRow[]>;
  me?: Partial<Record<BoardGame, { rank: number; value: number }>>;
}

export const BOARD_LABELS: Record<BoardGame, { title: string; unit: (v: number) => string }> = {
  bowling: { title: 'Bowling', unit: (v) => `${v}` },
  pool: { title: 'Pool', unit: (v) => `${v} ${v === 1 ? 'win' : 'wins'}` },
  marble_race: { title: 'Marble Race', unit: (v) => `${v} ${v === 1 ? 'win' : 'wins'}` },
};

export function myName(): string | null {
  try { return localStorage.getItem('qt:name'); } catch { return null; }
}

/** Tonight's boards, refreshed every `pollMs` and whenever the tab regains focus. */
export function useLeaderboard(name: string | null, pollMs = 30_000) {
  const [data, setData] = useState<BoardData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = name ? `?name=${encodeURIComponent(name)}` : '';
      const res = await fetch(`/api/leaderboard${q}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as BoardData);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [name]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), pollMs);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load, pollMs]);

  return { data, failed, reload: load };
}
