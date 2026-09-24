'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ably from 'ably';
import type { Match } from '@/types/match';

export type MatchEvent<M extends Match = Match> =
  | { type: 'shot'; seq: number; actorId: string; match: M }
  | { type: 'update'; match: M; reason: string };

export interface MatchNet<M extends Match = Match> {
  submit: (seq: number, payload: unknown) => Promise<boolean>;
  subscribe: (cb: (e: MatchEvent<M>) => void) => () => void;
  fetchRec: <R>(seq: number) => Promise<R | null>;
  rematch: () => Promise<void>;
}

/**
 * Everything a turn-based game room needs: who I am, the current match, live
 * shot/update events over Ably, and the calls to submit shots or rematch.
 */
export function useMatch<M extends Match>(sessionId: string) {
  const [meId, setMeId] = useState<string | null>(null);
  const [match, setMatch] = useState<M | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listeners = useRef(new Set<(e: MatchEvent<M>) => void>());

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/match`, { cache: 'no-store' });
    if (!res.ok) { setError(res.status === 404 ? 'No game running at this table.' : 'Could not load the game.'); return; }
    setMatch((await res.json()) as M);
  }, [sessionId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`qt:player:${sessionId}`);
      const info = raw ? (JSON.parse(raw) as { playerId: string }) : null;
      if (!info?.playerId) { setError('You are not at this table.'); return; }
      setMeId(info.playerId);
    } catch { setError('You are not at this table.'); return; }
    void load();
  }, [sessionId, load]);

  // Live events
  useEffect(() => {
    if (!meId) return;
    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(meId)}&sessionId=${encodeURIComponent(sessionId)}`,
    });
    const ch = client.channels.get(`qt:session:${sessionId}`);
    void ch.subscribe((msg) => {
      if (msg.name === 'match:shot') {
        const d = msg.data as { seq: number; actorId: string; match: M };
        listeners.current.forEach((l) => l({ type: 'shot', ...d }));
      } else if (msg.name === 'match:update') {
        const d = msg.data as { match: M; reason: string };
        listeners.current.forEach((l) => l({ type: 'update', ...d }));
      } else if (msg.name === 'match:started') {
        void load(); // rematch — room remounts the game from the fresh match
      }
    });
    return () => { ch.unsubscribe(); client.close(); };
  }, [meId, sessionId, load]);

  // Keep the session alive while people play
  useEffect(() => {
    if (!meId) return;
    const t = setInterval(() => { void fetch(`/api/sessions/${sessionId}/heartbeat`, { method: 'PATCH' }); }, 60_000);
    return () => clearInterval(t);
  }, [meId, sessionId]);

  // Stable identity: games subscribe with it in effects.
  const net = useMemo<MatchNet<M>>(() => ({
    submit: async (seq, payload) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/match/shot`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: meId, seq, payload }),
          });
          if (res.ok) return true;
          if (res.status === 409 || res.status === 403) { void load(); return false; } // out of sync: resync
        } catch { /* network blip — retry */ }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
      void load();
      return false;
    },
    subscribe: (cb) => { listeners.current.add(cb); return () => { listeners.current.delete(cb); }; },
    fetchRec: async <R,>(seq: number) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch(`/api/sessions/${sessionId}/match/rec?seq=${seq}`, { cache: 'no-store' });
        if (res.ok) return (await res.json()) as R;
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    },
    rematch: async () => {
      await fetch(`/api/sessions/${sessionId}/match/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: meId }),
      });
    },
  }), [sessionId, meId, load]);

  return { meId, match, error, net, reload: load };
}
