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

  // A match is already running at this table and I'm in it → straight back in
  useEffect(() => {
    if (!session || !playerInfo || session.status !== "playing") return;
    if (session.game !== "bowling" && session.game !== "pool") return;
    if (session.players.some((p) => p.id === playerInfo.playerId)) router.replace(`/session/${sessionId}/${session.game}`);
  }, [session, playerInfo, sessionId, router]);

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
        const { seed } = msg.data as { sessionId: string; seed: number };
        router.push(`/session/${sessionId}/race?seed=${seed}`);
      }
      if (msg.name === "bowl:started") {
        router.push(`/session/${sessionId}/bowling`);
      }
      if (msg.name === "match:started") {
        const { game } = msg.data as { game: string };
        router.push(`/session/${sessionId}/${game}`);
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

  async function handleStartMatch() {
    if (!playerInfo) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/match/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerInfo.playerId }),
      });
      if (!res.ok) {
        setStarting(false);
        setError("Couldn't start the game. Try again.");
      }
      // match:started Ably message drives the transition for everyone
    } catch {
      setStarting(false);
      setError("Couldn't start the game. Try again.");
    }
  }

  async function handleStartRace() {
    if (!playerInfo) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerInfo.playerId }),
      });
      if (!res.ok) {
        setStarting(false);
        setError("Couldn't start the race. Try again.");
      }
      // game:started Ably message drives the transition for all players
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
      <main className="flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <span className="neon-sign text-xl animate-pulse">Loading…</span>
      </main>
    );
  }

  const isCreator = session.players[0]?.id === playerInfo.playerId;
  const takenColors = session.players
    .filter((p) => p.id !== playerInfo.playerId)
    .map((p) => p.color);

  return (
    <main className="flex flex-col w-full max-w-md mx-auto" style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-[var(--qt-line)]">
        <button
          onClick={() => void handleLeave()}
          className="text-sm text-[var(--qt-mute)] active:text-[var(--qt-cream)]"
        >
          ← Leave
        </button>
        <h1 className="neon-sign text-lg leading-none pt-0.5">
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
        <div className="flex items-center gap-2">
          <span className="live-dot w-2 h-2 rounded-full" />
          <p className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">
            {isCreator ? "Waiting for players" : "Waiting for the host"}
          </p>
        </div>

        {/* Player list */}
        <div className="w-full max-w-sm space-y-3">
          {session.players.map((player) => {
            const isMe = player.id === playerInfo.playerId;
            return (
              <div
                key={player.id}
                className={`flex items-center gap-3 rounded-2xl bg-[var(--qt-panel)] border px-4 py-3 ${
                  isMe ? "border-[var(--qt-amber)]/40" : "border-[var(--qt-line)]"
                }`}
              >
                <span
                  className="w-8 h-8 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: player.color,
                    boxShadow: `0 0 10px ${player.color}88`,
                  }}
                />
                <span className="font-semibold text-sm truncate flex-1">
                  {player.name}
                  {isMe && (
                    <span className="ml-2 text-xs text-[var(--qt-mute)] font-normal">
                      (you)
                    </span>
                  )}
                </span>
                {isMe && session.game === "marble_race" && (
                  <button
                    onClick={() => setShowColorPicker(true)}
                    className="text-xs text-[var(--qt-mute)] underline underline-offset-2 active:text-[var(--qt-cream)]"
                  >
                    Change
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Start game — creator only */}
      {isCreator && (
        <div className="px-4 py-4 border-t border-[var(--qt-line)]">
          {session.game === "bowling" || session.game === "pool" ? (
            <>
              <button
                onClick={() => void handleStartMatch()}
                disabled={starting}
                className="btn-amber w-full rounded-2xl py-4 text-lg font-bold uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-50"
              >
                {starting ? "Starting…" : session.game === "pool" ? "Rack 'em" : "Start Bowling"}
              </button>
              {session.game === "pool" && session.players.filter((p) => !p.isNpc).length === 1 && (
                <p className="text-center text-xs text-[var(--qt-mute)] mt-2">
                  Solo? A regular will play you.
                </p>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => void handleStartRace()}
                disabled={starting}
                className="btn-amber w-full rounded-2xl py-4 text-lg font-bold uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-50"
              >
                {starting ? "Starting…" : "Start Race"}
              </button>
              {session.players.length === 1 && (
                <p className="text-center text-xs text-[var(--qt-mute)] mt-2">
                  Solo? NPCs will fill the field.
                </p>
              )}
            </>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,10,20,0.9)]">
          <span className="neon-sign text-2xl animate-pulse">
            {session.game === "bowling" ? "Bowling starting…" : session.game === "pool" ? "Racking up…" : "Race starting…"}
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
      <div className="fixed inset-0 z-40 bg-black/70" onClick={onCancel} />
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
