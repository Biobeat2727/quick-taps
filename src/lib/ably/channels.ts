// Channel name helpers — all Quick Taps channels are namespaced qt:*
export const CHANNELS = {
  sessions: () => "qt:sessions",
  session: (id: string) => `qt:session:${id}`,
} as const;

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
