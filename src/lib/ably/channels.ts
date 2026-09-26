// Channel name helpers — all Quick Taps channels are namespaced qt:*

// NODE_ENV and NEXT_PUBLIC_* are inlined into the client bundle, so server and
// browser agree on the scope.
const LOBBY_SCOPE =
  process.env.NODE_ENV === "production" ? process.env.NEXT_PUBLIC_QT_VENUE_ID || "pilot" : "dev";

export const CHANNELS = {
  sessions: () => "qt:sessions",
  session: (id: string) => `qt:session:${id}`,
  /**
   * Presence: who has the app open at the bar right now. Scoped per venue —
   * and dev is its own scope, since dev and production share one Ably app.
   */
  lobby: () => `qt:lobby:${LOBBY_SCOPE}`,
  /** Per-device inbox for challenges; only the server publishes here. */
  inbox: (clientId: string) => `qt:inbox:${clientId}`,
} as const;

// ── qt:lobby presence data ───────────────────────────────────────────────────

export interface LobbyPresence {
  name: string;
  status: "browsing" | "table" | "playing";
  game?: "marble_race" | "bowling" | "pool";
}

// ── qt:inbox:{clientId} messages ─────────────────────────────────────────────

export interface ChallengeMessage {
  name: "challenge";
  data: { sessionId: string; game: "marble_race" | "bowling" | "pool"; fromId: string; fromName: string; expiresAt: number };
}
export interface ChallengeDeclinedMessage {
  name: "challenge:declined";
  data: { sessionId: string; byName: string };
}

// ── qt:sessions messages ────────────────────────────────────────────────────

export interface SessionListUpdatedMessage {
  name: "session:list:updated";
  data: null;
}

// ── qt:session:{id} messages ─────────────────────────────────────────────────

export interface PlayerJoinedMessage {
  name: "player:joined";
  data: {
    playerId: string;
    playerName: string;
    color: string;
  };
}

export interface PlayerLeftMessage {
  name: "player:left";
  data: {
    playerId: string;
  };
}

export interface PlayerColorChangedMessage {
  name: "player:color:changed";
  data: {
    playerId: string;
    color: string;
  };
}

export interface GameStartedMessage {
  name: "game:started";
  data: {
    sessionId: string;
    mode: '2d' | '3d';
    seed: number;
  };
}

// ── Bowling messages ──────────────────────────────────────────────────────────

import type { BowlingGameState } from '@/types/bowling';

export interface BowlStartedMessage {
  name: "bowl:started";
  data: {
    sessionId: string;
  };
}

export interface BowlThrowMessage {
  name: "bowl:throw";
  data: {
    playerId: string;
    throwIndex: number;
    knockedPins: boolean[];
    gameState: BowlingGameState;
  };
}

export interface BowlGameOverMessage {
  name: "bowl:game:over";
  data: {
    finalScores: Record<string, number>;
  };
}

// ── Union types ───────────────────────────────────────────────────────────────

export type SessionsMessage = SessionListUpdatedMessage;
export type SessionMessage =
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerColorChangedMessage
  | GameStartedMessage
  | BowlStartedMessage
  | BowlThrowMessage
  | BowlGameOverMessage;
