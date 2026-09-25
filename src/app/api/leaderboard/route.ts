export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { tonightsBoards, playerKey, BOARD_GAMES, type BoardGame } from '@/lib/scores/scores';

/**
 * GET /api/leaderboard?name=Davey — tonight's top 10 per game, plus (with
 * ?name) where that player stands on each board.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name');
  try {
    const { night, games, all } = await tonightsBoards(10);
    let me: Partial<Record<BoardGame, { rank: number; value: number }>> | undefined;
    if (name) {
      const key = playerKey(name);
      me = {};
      for (const g of BOARD_GAMES) {
        const i = all[g].findIndex((r) => playerKey(r.name) === key);
        if (i >= 0) me[g] = { rank: i + 1, value: all[g][i].value };
      }
    }
    return Response.json({ night, games, me }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/leaderboard', err);
    return Response.json({ error: 'Leaderboard unavailable' }, { status: 503 });
  }
}
