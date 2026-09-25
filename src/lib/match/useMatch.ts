'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ably from 'ably';
import type { Match } from '@/types/match';

export type MatchEvent<M extends Match = Match> =
  | { type: 'shot'; seq: number; actorId: string; match: M }
  | { type: 'update'; match: M; reason: string; actorId?: string };

/** The current turn's shot clock, converted to this phone's clock. */
export interface ShotClock {
  deadline: number | null; // local ms
  seq: number;
}

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
  const [clock, setClock] = useState<ShotClock | null>(null);
  const listeners = useRef(new Set<(e: MatchEvent<M>) => void>());

  // serverNow/now ride along with every match we receive; the difference to our
  // own clock corrects the deadline for phones whose clocks are off.
  const noteClock = useCallback((m: Match, serverNow?: number) => {
    const skew = serverNow ? Date.now() - serverNow : 0;
    setClock((c) => (c && c.seq > m.seq ? c : { deadline: m.turnDeadline && !m.over ? m.turnDeadline + skew : null, seq: m.seq }));
  }, []);

  /** Fetch the server's match. `resync`: the server refused something we did, so games must adopt this even at the same seq. */
  const load = useCallback(async (resync = false) => {
    const res = await fetch(`/api/sessions/${sessionId}/match`, { cache: 'no-store' });
    if (!res.ok) { setError(res.status === 404 ? 'No game running at this table.' : 'Could not load the game.'); return; }
    const m = (await res.json()) as M;
    let me: string | null = null;
    try { me = (JSON.parse(localStorage.getItem(`qt:player:${sessionId}`) ?? 'null') as { playerId?: string } | null)?.playerId ?? null; } catch { /* no id */ }
    if (me && !m.over && !m.players.some((p) => p.id === me)) {
      // e.g. dropped by the shot clock while this phone was away
      setError("You're not in this game anymore.");
      return;
    }
    noteClock(m, m.serverNow);
    setMatch({ ...m, resync });
  }, [sessionId, noteClock]);

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
        const d = msg.data as { seq: number; actorId: string; match: M; now?: number };
        noteClock(d.match, d.now);
        listeners.current.forEach((l) => l({ type: 'shot', seq: d.seq, actorId: d.actorId, match: d.match }));
      } else if (msg.name === 'match:update') {
        const d = msg.data as { match: M; reason: string; actorId?: string; now?: number };
        noteClock(d.match, d.now);
        listeners.current.forEach((l) => l({ type: 'update', match: d.match, reason: d.reason, actorId: d.actorId }));
      } else if (msg.name === 'player:left') {
        const d = msg.data as { playerId: string; reason?: string };
        if (d.playerId === meId && d.reason === 'timeout') setError('You timed out twice, so you were taken off the table.');
      } else if (msg.name === 'match:started') {
        void load(); // rematch — room remounts the game from the fresh match
      }
    });
    return () => { ch.unsubscribe(); client.close(); };
  }, [meId, sessionId, load, noteClock]);

  // When the clock runs out, report it (every phone at the table does; the
  // server accepts exactly one). Jitter spreads the reports out a little.
  // This phone may be the only reporter, so it must not give up on a blip.
  const clockSeq = useRef(-1);
  useEffect(() => { clockSeq.current = clock?.seq ?? -1; }, [clock]);
  useEffect(() => {
    if (!meId || !clock?.deadline) return;
    const { deadline, seq } = clock;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const stillCurrent = () => !cancelled && clockSeq.current === seq;
    const report = async (attempt: number) => {
      if (!stillCurrent()) return;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/match/timeout`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: meId, seq }),
        });
        if (res.status === 425) {
          // Our clock ran fast — re-arm from the server's deadline (noteClock ignores it if we've moved on)
          const body = (await res.json()) as { match?: Match };
          if (body.match && stillCurrent()) noteClock(body.match, body.match.serverNow);
          return;
        }
        if (res.status === 409) { if (stillCurrent()) void load(true); return; } // someone beat us to it
        if (res.ok) {
          // The Ably update should follow; if it doesn't, fetch the truth ourselves
          t = setTimeout(() => { if (stillCurrent()) void load(true); }, 3_000);
          return;
        }
      } catch { /* network blip */ }
      if (attempt < 6) t = setTimeout(() => void report(attempt + 1), 1_500 * (attempt + 1));
      else if (stillCurrent()) void load(true);
    };
    t = setTimeout(() => void report(0), Math.max(0, deadline - Date.now()) + 400 + Math.random() * 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [meId, sessionId, clock, noteClock, load]);

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
          if (res.status === 409 || res.status === 403) { void load(true); return false; } // refused (stale / clock ran out): adopt the server's truth
        } catch { /* network blip — retry */ }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
      void load(true);
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

  return { meId, match, error, net, reload: load, deadline: clock?.deadline ?? null };
}
