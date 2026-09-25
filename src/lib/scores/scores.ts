// Leaderboard writes and reads (server only). Writes never throw — a database
// hiccup must not break a game — and are idempotent via dedupe_key.

import { prisma } from '@/lib/db/client';
import { VENUE_ID, nightOf } from '@/lib/venue';
import { computeFrameScores, isGameComplete } from '@/lib/bowling/bowling-logic';
import type { Match } from '@/types/match';

export type BoardGame = 'bowling' | 'pool' | 'marble_race';
export const BOARD_GAMES: BoardGame[] = ['bowling', 'pool', 'marble_race'];

export const playerKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

interface ScoreInput {
  game: BoardGame;
  kind: 'game' | 'win';
  playerName: string;
  value: number;
  vsHumans: boolean;
  sessionId: string;
  dedupeKey: string;
  countsAt?: Date;
}

export async function recordScores(rows: ScoreInput[]): Promise<void> {
  if (!rows.length) return;
  try {
    await prisma.qtScore.createMany({
      data: rows.map((r) => {
        const countsAt = r.countsAt ?? new Date();
        return {
          venueId: VENUE_ID,
          night: nightOf(countsAt),
          game: r.game,
          kind: r.kind,
          playerName: r.playerName.trim().slice(0, 32),
          playerKey: playerKey(r.playerName),
          value: r.value,
          vsHumans: r.vsHumans,
          sessionId: r.sessionId,
          dedupeKey: r.dedupeKey,
          countsAt,
        };
      }),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error('recordScores failed', err);
  }
}

const bowlingTotal = (m: Extract<Match, { game: 'bowling' }>, id: string) =>
  computeFrameScores((m.state.throwHistory[id] ?? []).flat()).filter((v) => v != null).pop() ?? 0;

/**
 * Leaderboard rows for a finished turn-based match. Bowling: every human's
 * completed game counts (solo too — you bowl against the pins). Pool: a win
 * counts only against another human.
 */
export function matchScores(sessionId: string, m: Match): ScoreInput[] {
  if (!m.over) return [];
  const humans = m.players.filter((p) => !p.isNpc);
  const vsHumans = humans.length >= 2;
  const base = `${sessionId}:${m.startedAt}`;

  if (m.game === 'bowling') {
    const ids = m.players.map((p) => p.id);
    if (!isGameComplete(m.state, ids)) return [];
    return humans.map((p) => ({
      game: 'bowling' as const, kind: 'game' as const, playerName: p.name,
      value: bowlingTotal(m, p.id), vsHumans, sessionId, dedupeKey: `${base}:${p.id}`,
    }));
  }

  const w = m.state.winner;
  const winner = w === null ? null : m.players[w];
  if (!winner || winner.isNpc || !vsHumans) return [];
  return [{ game: 'pool', kind: 'win', playerName: winner.name, value: 1, vsHumans, sessionId, dedupeKey: `${base}:win` }];
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface BoardRow { name: string; value: number }
export interface Board { night: string; games: Record<BoardGame, BoardRow[]> }

/**
 * Tonight's boards: bowling = best single game per player; pool / marble =
 * wins per player. Ties go to whoever got there first.
 */
export async function tonightsBoards(limit = 10): Promise<Board & { all: Record<BoardGame, BoardRow[]> }> {
  const night = nightOf();
  const rows = await prisma.qtScore.findMany({
    where: { venueId: VENUE_ID, night, countsAt: { lte: new Date() } },
    orderBy: { countsAt: 'asc' },
    select: { game: true, kind: true, playerName: true, playerKey: true, value: true, countsAt: true },
  });

  const all = {} as Record<BoardGame, BoardRow[]>;
  for (const game of BOARD_GAMES) {
    const byPlayer = new Map<string, { name: string; value: number; at: number }>();
    for (const r of rows) {
      if (r.game !== game) continue;
      const cur = byPlayer.get(r.playerKey);
      const at = r.countsAt.getTime();
      if (game === 'bowling') {
        if (!cur || r.value > cur.value) byPlayer.set(r.playerKey, { name: r.playerName, value: r.value, at });
      } else {
        byPlayer.set(r.playerKey, { name: r.playerName, value: (cur?.value ?? 0) + r.value, at });
      }
    }
    all[game] = [...byPlayer.values()]
      .sort((a, b) => b.value - a.value || a.at - b.at)
      .map(({ name, value }) => ({ name, value }));
  }
  const games = Object.fromEntries(BOARD_GAMES.map((g) => [g, all[g].slice(0, limit)])) as Record<BoardGame, BoardRow[]>;
  return { night, games, all };
}
