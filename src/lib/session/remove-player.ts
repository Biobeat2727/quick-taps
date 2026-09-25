// Take a player out of a table: the explicit Leave button, or the shot clock
// dropping someone who walked off. Pool concedes, bowling passes the lane on;
// the table is deleted once no humans remain.

import { getSession, setSession, deleteSession, removeSessionFromIndex } from '@/lib/redis/session';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';
import { getMatch, setMatch, dropPlayer } from '@/lib/match/match-server';
import { recordScores, matchScores } from '@/lib/scores/scores';

export async function removePlayer(sessionId: string, playerId: string, reason: 'left' | 'timeout'): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;

  const sessionChannel = ablyRest.channels.get(CHANNELS.session(sessionId));
  await sessionChannel.publish('player:left', { playerId, reason });

  session.players = session.players.filter((p) => p.id !== playerId);

  const match = await getMatch(sessionId);
  if (match) {
    const next = dropPlayer(match, playerId, reason === 'timeout');
    if (next) {
      await setMatch(sessionId, next);
      if (next.over) session.status = 'lobby';
      await sessionChannel.publish('match:update', { match: next, reason, actorId: playerId, now: Date.now() });
      // A walk-off can end the game (pool forfeit, or the last bowler finishing the rotation)
      if (next.over) await recordScores(matchScores(sessionId, next));
    }
  }

  // NPCs don't hold a table open — delete once the last human leaves
  if (!session.players.some((p) => !p.isNpc)) {
    await deleteSession(sessionId);
    await removeSessionFromIndex(sessionId);
  } else {
    session.lastActivity = Date.now();
    await setSession(session);
  }

  await ablyRest.channels.get(CHANNELS.sessions()).publish('session:list:updated', null);
  return true;
}
