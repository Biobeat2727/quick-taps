"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Ably from "ably";
import type { Session } from "@/types/session";
import { GAME_LABELS, MARBLE_COLORS } from "@/lib/constants";

type PlayerInfo = { playerId: string; color: string };

function getPlayerInfo(sessionId: string): PlayerInfo | null {
  try {
    const raw = localStorage.getItem(`qt:player:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getBrowserId(): string {
  let id = localStorage.getItem("qt:browserId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("qt:browserId", id);
  }
  return id;
}

export default function SessionRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pickingMode, setPickingMode] = useState(false);
  const playerInfoRef = useRef<PlayerInfo | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (res.ok) {
        setSession(await res.json());
      } else if (res.status === 404) {
        router.replace("/");
      }
    } catch {
      // ignore — stale data ok
    }
  }, [sessionId, router]);

  // Init: read localStorage, redirect if no player info
  useEffect(() => {
    const info = getPlayerInfo(sessionId);
    if (!info) {
      router.replace("/");
      return;
    }
    setPlayerInfo(info);
    playerInfoRef.current = info;
    void fetchSession();
  }, [sessionId, router, fetchSession]);

  // Ably subscription
  useEffect(() => {
    if (!playerInfo) return;
    const client = new Ably.Realtime({
      authUrl: `/api/ably/token?playerId=${encodeURIComponent(playerInfo.playerId)}&sessionId=${encodeURIComponent(sessionId)}`,
    });
    const channel = client.channels.get(`qt:session:${sessionId}`);
    void channel.subscribe((msg) => {
      if (
        msg.name === "player:joined" ||
        msg.name === "player:left" ||
        msg.name === "player:color:changed"
      ) {
        void fetchSession();
      }
      if (msg.name === "game:started") {
        const { mode, seed } = msg.data as { sessionId: string; mode: string; seed: number };
        router.push(`/session/${sessionId}/race?mode=${mode}&seed=${seed}`);
      }
    });
    return () => {
      channel.unsubscribe();
      client.close();
    };
  }, [playerInfo, sessionId, fetchSession]);

  // Heartbeat every 60s
  useEffect(() => {
    if (!playerInfo) return;
    const interval = setInterval(() => {
      void fetch(`/api/sessions/${sessionId}/heartbeat`, { method: "PATCH" });
    }, 60_000);
    return () => clearInterval(interval);
  }, [playerInfo, sessionId]);

  // Leave on tab close / refresh
  useEffect(() => {
    if (!playerInfo) return;
    const handleBeforeUnload = () => {
      const info = playerInfoRef.current;
      if (!info) return;
      navigator.sendBeacon(
        `/api/sessions/${sessionId}/leave`,
        new Blob([JSON.stringify({ playerId: info.playerId })], {
          type: "application/json",
        })
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [playerInfo, sessionId]);

  async function handleLeave() {
    if (!playerInfo) return;
    await fetch(`/api/sessions/${sessionId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerInfo.playerId }),
    });
    router.push("/");
  }

  async function handleStartWithMode(mode: '2d' | '3d') {
    if (!playerInfo) return;
    setPickingMode(false);
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerInfo.playerId, mode }),
      });
      if (!res.ok) {
        setStarting(false);
        setError("Couldn't start the race. Try again.");
      }
      // game:started Ably message (with mode) drives the transition for all players
    } catch {
      setStarting(false);
      setError("Couldn't start the race. Try again.");
    }
  }

  async function handleColorChange(newColor: string) {
    if (!playerInfo) return;
    setShowColorPicker(false);
    const res = await fetch(`/api/sessions/${sessionId}/color`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerInfo.playerId, color: newColor }),
    });
    if (res.status === 409) {
      setError("That color was just taken. Pick another.");
      setShowColorPicker(true);
      return;
    }
    if (res.ok) {
      const updated: PlayerInfo = { playerId: playerInfo.playerId, color: newColor };
      localStorage.setItem(`qt:player:${sessionId}`, JSON.stringify(updated));
      setPlayerInfo(updated);
      playerInfoRef.current = updated;
      await fetchSession();
    }
  }

  if (!session || !playerInfo) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gray-950">
        <span className="text-amber-400 animate-pulse">Loading…</span>
      </main>
    );
  }

  const isCreator = session.players[0]?.id === playerInfo.playerId;
  const takenColors = session.players
    .filter((p) => p.id !== playerInfo.playerId)
    .map((p) => p.color);

  return (
    <main className="flex min-h-dvh flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800/60">
        <button
          onClick={() => void handleLeave()}
          className="text-sm text-gray-400 active:text-gray-200"
        >
          ← Leave
        </button>
        <h1 className="text-base font-bold text-amber-400">
          {GAME_LABELS[session.game] ?? session.game}
        </h1>
        <div className="w-14" />
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

      {/* Waiting room */}
      <div className="flex-1 flex flex-col items-center px-4 py-8 gap-6">
        <p className="text-sm text-gray-400">
          {isCreator ? "Waiting for players to join…" : "Waiting for the host to start…"}
        </p>

        {/* Player list */}
        <div className="w-full max-w-sm space-y-3">
          {session.players.map((player) => {
            const isMe = player.id === playerInfo.playerId;
            return (
              <div
                key={player.id}
                className="flex items-center gap-3 rounded-2xl bg-gray-800/80 border border-gray-700/40 px-4 py-3"
              >
                <span
                  className="w-8 h-8 rounded-full flex-shrink-0 border-2 border-white/10"
                  style={{ backgroundColor: player.color }}
                />
                <span className="font-semibold text-sm truncate flex-1">
                  {player.name}
                  {isMe && (
                    <span className="ml-2 text-xs text-gray-500 font-normal">
                      (you)
                    </span>
                  )}
                </span>
                {isMe && (
                  <button
                    onClick={() => setShowColorPicker(true)}
                    className="text-xs text-gray-500 underline underline-offset-2 active:text-gray-300"
                  >
                    Change
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Start Race — creator only */}
      {isCreator && (
        <div className="px-4 py-4 border-t border-gray-800/60">
          {!pickingMode ? (
            <>
              <button
                onClick={() => setPickingMode(true)}
                disabled={starting}
                className="w-full rounded-2xl py-4 text-lg font-bold bg-amber-400 text-gray-950 active:scale-95 transition-transform disabled:opacity-50"
              >
                {starting ? "Starting…" : "Start Race"}
              </button>
              {session.players.length === 1 && (
                <p className="text-center text-xs text-gray-500 mt-2">
                  Solo? NPCs will fill the field.
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-center text-sm font-semibold text-amber-400">Choose a view</p>
              <div className="flex gap-3">
                <button
                  onClick={() => void handleStartWithMode('2d')}
                  className="flex-1 rounded-2xl py-5 bg-amber-400 text-gray-950 font-bold text-base active:scale-95 transition-transform"
                >
                  2D Classic
                </button>
                <button
                  onClick={() => void handleStartWithMode('3d')}
                  className="flex-1 rounded-2xl py-5 bg-white/10 text-white font-bold text-base border border-white/15 active:scale-95 transition-transform"
                >
                  3D
                </button>
              </div>
              <button
                onClick={() => setPickingMode(false)}
                className="text-center text-xs text-gray-500 py-1 active:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Color picker bottom sheet */}
      {showColorPicker && (
        <ColorPickerSheet
          takenColors={takenColors}
          onPick={(c) => void handleColorChange(c)}
          onCancel={() => setShowColorPicker(false)}
        />
      )}

      {/* Start Race initiated overlay */}
      {starting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90">
          <span className="text-amber-400 text-xl animate-pulse">
            Race starting…
          </span>
        </div>
      )}
    </main>
  );
}

// ── ColorPickerSheet ──────────────────────────────────────────────────────────

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
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onCancel} />
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
