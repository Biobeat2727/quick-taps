"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Ably from "ably";
import type { GameId, Session } from "@/types/session";
import { GAME_LABELS, MARBLE_COLORS } from "@/lib/constants";

// Stable anonymous ID used as Ably clientId before the player joins a session
function getBrowserId(): string {
  let id = localStorage.getItem("qt:browserId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("qt:browserId", id);
  }
  return id;
}

type ColorPickerState = {
  action: "create" | "join";
  sessionId?: string;
  takenColors: string[];
  game?: GameId;
};

export default function HomePage() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [colorPicker, setColorPicker] = useState<ColorPickerState | null>(null);
  const [gamePicker, setGamePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Name check — redirect to /name if not set
  useEffect(() => {
    const name = localStorage.getItem("qt:name");
    if (!name) {
      router.replace("/name");
    } else {
      setPlayerName(name);
    }
  }, [router]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setSessions(await res.json());
    } catch {
      // ignore — list stays stale
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!playerName) return;
    void fetchSessions();
  }, [playerName, fetchSessions]);

  // Subscribe to qt:sessions for live updates
  useEffect(() => {
    if (!playerName) return;

    const browserId = getBrowserId();
    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(browserId)}`,
    });
    const channel = client.channels.get("qt:sessions");

    void channel.subscribe("session:list:updated", () => {
      void fetchSessions();
    });

    return () => {
      channel.unsubscribe();
      client.close();
    };
  }, [playerName, fetchSessions]);

  async function handleCreate(color: string) {
    if (!playerName) return;
    setColorPicker(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game: colorPicker?.game ?? "marble_race",
          playerName,
          playerColor: color,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const session: Session = await res.json();
      const player = session.players[0];
      localStorage.setItem(
        `qt:player:${session.id}`,
        JSON.stringify({ playerId: player.id, color })
      );
      router.push(`/session/${session.id}`);
    } catch {
      setError("Couldn't start the game. Try again.");
      setLoading(false);
    }
  }

  async function handleJoin(sessionId: string, color: string) {
    if (!playerName) return;
    setColorPicker(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, playerColor: color }),
      });
      if (res.status === 409) {
        // Color was taken by a race condition — re-open picker with updated session
        const updated = await fetch(`/api/sessions/${sessionId}`);
        const session: Session = updated.ok ? await updated.json() : null;
        setColorPicker({
          action: "join",
          sessionId,
          takenColors: session?.players.map((p) => p.color) ?? [],
        });
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to join");
      const { player } = await res.json();
      localStorage.setItem(
        `qt:player:${sessionId}`,
        JSON.stringify({ playerId: player.id, color })
      );
      router.push(`/session/${sessionId}`);
    } catch {
      setError("Couldn't join. Try again.");
      setLoading(false);
    }
  }

  if (!playerName) return null;

  return (
    <main className="flex flex-col w-full max-w-md mx-auto" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-[var(--qt-line)]">
        <h1 className="neon-sign text-xl leading-none pt-0.5">Quick Taps</h1>
        <span className="rounded-full bg-[var(--qt-panel)] border border-[var(--qt-line)] px-3 py-1.5 text-sm text-[var(--qt-cream)] max-w-[45%] truncate">
          {playerName}
        </span>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-red-900/50 border border-red-700 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400">
            ✕
          </button>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex items-center gap-2 mb-3">
          {sessions.length > 0 && (
            <span className="live-dot w-2 h-2 rounded-full" />
          )}
          <h2 className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">
            On the floor
          </h2>
        </div>
        {sessions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--qt-cream)] font-medium">
              The floor is quiet.
            </p>
            <p className="mt-1 text-sm text-[var(--qt-mute)]">
              Start a game and anyone at the bar can jump in.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onJoin={() =>
                setColorPicker({
                  action: "join",
                  sessionId: session.id,
                  takenColors: session.players.map((p) => p.color),
                })
              }
            />
          ))}
          </div>
        )}
      </div>

      {/* Start a game */}
      <div className="px-4 py-4 border-t border-[var(--qt-line)]">
        <button
          onClick={() => setGamePicker(true)}
          className="btn-amber w-full rounded-2xl py-4 text-lg font-bold uppercase tracking-wide active:scale-95 transition-transform"
        >
          Start a game
        </button>
      </div>

      {/* Game picker bottom sheet */}
      {gamePicker && (
        <GamePickerSheet
          onPick={(game) => {
            setGamePicker(false);
            setColorPicker({ action: "create", takenColors: [], game });
          }}
          onCancel={() => setGamePicker(false)}
        />
      )}

      {/* Color picker bottom sheet */}
      {colorPicker && (
        <ColorPickerSheet
          takenColors={colorPicker.takenColors}
          onPick={(color) => {
            if (colorPicker.action === "create") {
              void handleCreate(color);
            } else if (colorPicker.sessionId) {
              void handleJoin(colorPicker.sessionId, color);
            }
          }}
          onCancel={() => setColorPicker(null)}
        />
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,10,20,0.8)]">
          <span className="neon-sign text-2xl animate-pulse">Joining…</span>
        </div>
      )}
    </main>
  );
}

// ── SessionCard ────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onJoin,
}: {
  session: Session;
  onJoin: () => void;
}) {
  const live = session.status === "racing" || session.status === "playing";
  const cap = session.game === "pool" ? 2 : 6;
  const humans = session.players.filter((p) => !p.isNpc).length;
  const full = humans >= cap;
  const host = session.players[0];

  return (
    <div className="rounded-2xl bg-[var(--qt-panel)] border border-[var(--qt-line)] px-4 py-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-display text-[15px] text-[var(--qt-amber)] truncate">
          {GAME_LABELS[session.game] ?? session.game}
        </p>
        {host && (
          <p className="text-xs text-[var(--qt-mute)] mt-0.5 truncate">
            {host.name}&apos;s table
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-2">
          {session.players.map((p) => (
            <span
              key={p.id}
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{
                backgroundColor: p.color,
                boxShadow: `0 0 8px ${p.color}`,
              }}
              title={p.name}
            />
          ))}
          <span className="text-xs text-[var(--qt-mute)] ml-1">
            {humans}/{cap}
          </span>
        </div>
      </div>
      {live ? (
        <span className="flex-shrink-0 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--qt-ice)]">
          <span className="live-dot w-2 h-2 rounded-full" />
          {session.status === "racing" ? "Racing" : "Playing"}
        </span>
      ) : (
        <button
          onClick={onJoin}
          disabled={full}
          className="btn-amber flex-shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none active:scale-95 transition-transform"
        >
          {full ? "Full" : "Join"}
        </button>
      )}
    </div>
  );
}

// ── GamePickerSheet ─────────────────────────────────────────────────────────

function GamePickerSheet({
  onPick,
  onCancel,
}: {
  onPick: (game: GameId) => void;
  onCancel: () => void;
}) {
  const games: { id: GameId; label: string; description: string }[] = [
    { id: "pool", label: "Pool", description: "8-ball on a neon bar table" },
    { id: "bowling", label: "Bowling", description: "10-frame turn-based bowling" },
    { id: "marble_race", label: "Marble Race", description: "Physics marble race to the bottom" },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70" onClick={onCancel} />
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto rounded-t-3xl bg-[var(--qt-panel)] border-t border-[var(--qt-line)] px-6 pb-8 pt-6">
        <div className="w-10 h-1 rounded-full bg-[var(--qt-line)] mx-auto mb-5" />
        <h2 className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)] text-center mb-5">
          Pick a game
        </h2>
        <div className="flex flex-col gap-3">
          {games.map(({ id, label, description }) => (
            <button
              key={id}
              onClick={() => onPick(id)}
              className="w-full rounded-2xl py-4 px-5 bg-[var(--qt-panel-2)] border border-[var(--qt-line)] text-left active:scale-95 active:border-[var(--qt-amber)] transition-transform"
            >
              <div className="font-display text-[15px] text-[var(--qt-amber)]">
                {label}
              </div>
              <div className="text-xs text-[var(--qt-mute)] mt-1">
                {description}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="mt-5 w-full py-3 text-sm text-[var(--qt-mute)] active:text-[var(--qt-cream)]"
        >
          Cancel
        </button>
      </div>
    </>
  );
}

// ── ColorPickerSheet ────────────────────────────────────────────────────────

function ColorPickerSheet({
  takenColors,
  onPick,
  onCancel,
}: {
  takenColors: string[];
  onPick: (color: string) => void;
  onCancel: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70"
        onClick={onCancel}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto rounded-t-3xl bg-[var(--qt-panel)] border-t border-[var(--qt-line)] px-6 pb-8 pt-6">
        <div className="w-10 h-1 rounded-full bg-[var(--qt-line)] mx-auto mb-5" />
        <h2 className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)] text-center mb-5">
          Pick your marble
        </h2>
        <div className="grid grid-cols-4 gap-5">
          {MARBLE_COLORS.map(({ name, hex }) => {
            const taken = takenColors.includes(hex);
            return (
              <button
                key={hex}
                onClick={() => !taken && onPick(hex)}
                disabled={taken}
                className="flex flex-col items-center gap-1.5"
                aria-label={taken ? `${name} (taken)` : name}
              >
                <span
                  className={`w-14 h-14 rounded-full border-2 transition-transform ${
                    taken
                      ? "opacity-20 border-transparent cursor-not-allowed"
                      : "border-white/20 active:scale-90 cursor-pointer"
                  }`}
                  style={{
                    backgroundColor: hex,
                    boxShadow: taken ? "none" : `0 0 14px ${hex}66`,
                  }}
                />
                <span
                  className={`text-xs ${
                    taken ? "text-[var(--qt-line)]" : "text-[var(--qt-mute)]"
                  }`}
                >
                  {name}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={onCancel}
          className="mt-6 w-full py-3 text-sm text-[var(--qt-mute)] active:text-[var(--qt-cream)]"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
