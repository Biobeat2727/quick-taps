"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Ably from "ably";
import type { Session } from "@/types/session";
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
};

export default function HomePage() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [colorPicker, setColorPicker] = useState<ColorPickerState | null>(null);
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
          game: "marble_race",
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
    <main className="flex min-h-dvh flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60">
        <h1 className="text-lg font-bold text-amber-400">Quick Taps</h1>
        <span className="text-sm text-gray-400">{playerName}</span>
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {sessions.length === 0 ? (
          <p className="text-center text-gray-500 py-16 text-sm">
            No open games right now.
            <br />
            Start one below.
          </p>
        ) : (
          sessions.map((session) => (
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
          ))
        )}
      </div>

      {/* Start a game */}
      <div className="px-4 py-4 border-t border-gray-800/60">
        <button
          onClick={() =>
            setColorPicker({ action: "create", takenColors: [] })
          }
          className="w-full rounded-2xl py-4 text-lg font-bold bg-amber-400 text-gray-950 active:scale-95 transition-transform"
        >
          Start a game
        </button>
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/75">
          <span className="text-amber-400 text-lg animate-pulse">
            Joining…
          </span>
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
  const full = session.players.length >= 6;

  return (
    <div className="rounded-2xl bg-gray-800/80 border border-gray-700/40 px-4 py-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold truncate">
          {GAME_LABELS[session.game] ?? session.game}
        </p>
        <div className="flex items-center gap-1 mt-1.5">
          {session.players.map((p) => (
            <span
              key={p.id}
              className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0"
              style={{ backgroundColor: p.color }}
              title={p.name}
            />
          ))}
          <span className="text-xs text-gray-400 ml-1">
            {session.players.length}/6
          </span>
        </div>
      </div>
      <button
        onClick={onJoin}
        disabled={full}
        className="flex-shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold bg-amber-400 text-gray-950 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
      >
        {full ? "Full" : "Join"}
      </button>
    </div>
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
        className="fixed inset-0 z-40 bg-black/60"
        onClick={onCancel}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-gray-900 border-t border-gray-700 px-6 pb-8 pt-6">
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-5" />
        <h2 className="text-base font-bold text-center mb-5">
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
                  style={{ backgroundColor: hex }}
                />
                <span
                  className={`text-xs ${taken ? "text-gray-600" : "text-gray-300"}`}
                >
                  {name}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={onCancel}
          className="mt-6 w-full py-3 text-sm text-gray-500 active:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
