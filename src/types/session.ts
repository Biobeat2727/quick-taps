export type GameId = "marble_race" | "bowling";

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
  // Absent on sessions created before this field existed — treat as "lobby"
  status?: "lobby" | "racing";
}
