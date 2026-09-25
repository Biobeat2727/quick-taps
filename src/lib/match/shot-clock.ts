// Shot-clock length per game (client + server). The server adds a replay
// allowance on top so spectators finish watching the last shot first.
import type { MatchGame } from '@/types/match';

export const SHOT_CLOCK_MS: Record<MatchGame, number> = { bowling: 30_000, pool: 45_000 };
