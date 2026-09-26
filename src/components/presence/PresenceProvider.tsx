'use client';

// "At the bar now": one Ably connection for the whole app (it lives in the root
// layout, so it survives page changes). Everyone with a name enters presence on
// qt:lobby with what they're doing; challenges arrive on this device's private
// inbox channel and pop up on whatever page you're on.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Ably from 'ably';
import { CHANNELS, type LobbyPresence } from '@/lib/ably/channels';
import { GAME_LABELS, MARBLE_COLORS } from '@/lib/constants';
import type { GameId, Session } from '@/types/session';
import { getBrowserId } from '@/lib/browser-id';

export interface Person extends LobbyPresence { id: string }
export type Activity = Omit<LobbyPresence, 'name'>;

interface Incoming { sessionId: string; game: GameId; fromId: string; fromName: string; expiresAt: number }

interface PresenceCtx {
  meId: string | null;
  people: Person[];               // everyone here, me excluded
  setActivity: (a: Activity) => void;
  challenge: (to: Person, game: GameId) => Promise<void>;
}

const Ctx = createContext<PresenceCtx>({ meId: null, people: [], setActivity: () => {}, challenge: async () => {} });

export const usePresence = () => useContext(Ctx);

/** Pages declare what you're doing; it reverts to browsing when they unmount. */
export function useActivity(status: Activity['status'], game?: GameId) {
  const { setActivity } = usePresence();
  useEffect(() => {
    setActivity({ status, game });
    return () => setActivity({ status: 'browsing' });
  }, [setActivity, status, game]);
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const activityRef = useRef<Activity>({ status: 'browsing' });
  const handled = useRef(new Set<string>());

  // The name is set on /name; re-check as you navigate
  useEffect(() => {
    try {
      setName(localStorage.getItem('qt:name'));
      setMeId(getBrowserId());
    } catch { /* storage blocked: stay invisible */ }
  }, [pathname]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  // Connect once we know who we are
  useEffect(() => {
    if (!name || !meId) return;
    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(meId)}&lobby=1`,
      clientId: meId,
    });
    const lobby = client.channels.get(CHANNELS.lobby());
    // Rewind: a phone that blipped offline (screen lock, wifi) still gets a
    // challenge sent in the last 45 s when it reattaches.
    const inbox = client.channels.get(CHANNELS.inbox(meId), { params: { rewind: '45s' } });
    channelRef.current = lobby;

    const refresh = async () => {
      try {
        const members = await lobby.presence.get();
        const seen = new Map<string, Person>();
        for (const m of members) {
          if (m.clientId === meId || !m.data) continue;
          seen.set(m.clientId, { id: m.clientId, ...(m.data as LobbyPresence) });
        }
        setPeople([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
      } catch { /* connection blip — next presence event retries */ }
    };

    void lobby.presence.subscribe(() => void refresh()).catch(() => {});
    void lobby.presence.enter({ name, ...activityRef.current } satisfies LobbyPresence).then(refresh).catch(() => {});
    void inbox.subscribe((msg) => {
      if (handled.current.has(msg.id ?? '')) return; // rewinds can replay what we've seen
      handled.current.add(msg.id ?? '');
      if (msg.name === 'challenge') {
        const c = msg.data as Incoming;
        if (c.expiresAt > Date.now()) setIncoming(c);
      } else if (msg.name === 'challenge:declined') {
        const d = msg.data as { byName: string };
        flash(`${d.byName} passed. Your table's still open.`);
      }
    }).catch(() => {});

    return () => {
      channelRef.current = null;
      void lobby.presence.leave().catch(() => {});
      client.close();
    };
  }, [name, meId, flash]);

  const setActivity = useCallback((a: Activity) => {
    activityRef.current = a;
    const ch = channelRef.current;
    if (ch && name) void ch.presence.update({ name, ...a } satisfies LobbyPresence).catch(() => {});
  }, [name]);

  // Challenges expire on their own
  useEffect(() => {
    if (!incoming) return;
    const t = setTimeout(() => setIncoming(null), Math.max(0, incoming.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [incoming]);

  const challenge = useCallback(async (to: Person, game: GameId) => {
    if (!name || !meId) return;
    const res = await fetch('/api/challenge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: meId, fromName: name, toId: to.id, game }),
    });
    if (!res.ok) { flash("Couldn't send the challenge. Try again."); return; }
    const { session, player } = (await res.json()) as { session: Session; player: { id: string; color: string } };
    localStorage.setItem(`qt:player:${session.id}`, JSON.stringify({ playerId: player.id, color: player.color }));
    flash(`Challenge sent to ${to.name}`);
    router.push(`/session/${session.id}`);
  }, [name, meId, router, flash]);

  const accept = async () => {
    if (!incoming || !name) return;
    setBusy(true);
    try {
      const sRes = await fetch(`/api/sessions/${incoming.sessionId}`);
      if (!sRes.ok) { flash('That table closed.'); setIncoming(null); return; }
      const session = (await sRes.json()) as Session;
      const taken = session.players.map((p) => p.color);
      const color = MARBLE_COLORS.find((c) => !taken.includes(c.hex))?.hex ?? MARBLE_COLORS[1].hex;
      const res = await fetch(`/api/sessions/${incoming.sessionId}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, playerColor: color }),
      });
      if (!res.ok) { flash("Couldn't join — the game may have started."); setIncoming(null); return; }
      const { player } = (await res.json()) as { player: { id: string } };
      localStorage.setItem(`qt:player:${incoming.sessionId}`, JSON.stringify({ playerId: player.id, color }));
      setIncoming(null);
      router.push(`/session/${incoming.sessionId}`);
    } finally {
      setBusy(false);
    }
  };

  const decline = () => {
    if (!incoming || !name) return;
    void fetch('/api/challenge/decline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: incoming.fromId, byName: name, sessionId: incoming.sessionId }),
    });
    setIncoming(null);
  };

  const value = useMemo(() => ({ meId, people, setActivity, challenge }), [meId, people, setActivity, challenge]);

  return (
    <Ctx.Provider value={value}>
      {children}

      {incoming && (
        <div className="fixed inset-x-0 bottom-0 z-[100] px-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <div
            role="alertdialog"
            aria-label="Challenge"
            className="mx-auto max-w-md rounded-2xl border px-4 py-4"
            style={{
              background: 'rgba(20,14,34,0.97)', borderColor: 'var(--qt-amber, #ffb424)',
              boxShadow: '0 0 30px rgba(255,180,36,0.35)', animation: 'qtChallengeIn .45s cubic-bezier(.2,1.3,.3,1) both',
            }}
          >
            <p className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">Challenge</p>
            <p className="font-display text-[20px] leading-tight mt-1 text-[var(--qt-cream)]">
              <span className="text-[var(--qt-amber)]">{incoming.fromName}</span> wants a game of {GAME_LABELS[incoming.game] ?? incoming.game}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => void accept()}
                disabled={busy}
                className="btn-amber flex-1 rounded-xl py-3 font-bold uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-60"
              >
                {busy ? 'Joining…' : "You're on"}
              </button>
              <button
                onClick={decline}
                disabled={busy}
                className="flex-1 rounded-xl py-3 font-bold uppercase tracking-wide border border-[var(--qt-line)] text-[var(--qt-cream)] bg-[var(--qt-panel-2)]"
              >
                Not now
              </button>
            </div>
          </div>
          <style>{`@keyframes qtChallengeIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}`}</style>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pointer-events-none" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <div className="rounded-full px-4 py-2 text-sm text-[var(--qt-cream)] border border-[var(--qt-line)]" style={{ background: 'rgba(20,14,34,0.95)' }}>
            {toast}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
