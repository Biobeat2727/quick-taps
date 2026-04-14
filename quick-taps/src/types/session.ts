export type GameId = "marble_race";

export interface SessionPlayer {
  id: string;
  name: string;
  color: string; // hex e.g. "#E24B4A"
  isNpc: boolean;
}

export interface Session {
  id: string;
  game: GameId;
  createdAt: number; // unix ms
  lastActivity: number; // unix ms
  players: SessionPlayer[];
}
