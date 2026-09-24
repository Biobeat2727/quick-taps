import { ballGroup } from './pool-constants';
import type { PoolGameState, PoolGroup, PoolShotResult } from '@/types/pool';

export function isFoul(cueBallPocketed: boolean): boolean {
  return cueBallPocketed;
}

export function didPocketOwn(state: PoolGameState, finalPocketed: boolean[]): boolean {
  const group = state.playerGroups[state.activePlayerId];
  if (!group) return false;
  for (let i = 1; i <= 15; i++) {
    if (i === 8) continue;
    if (finalPocketed[i] && ballGroup(i) === group) return true;
  }
  return false;
}

// Win shot: 8-ball pocketed this shot AND all own balls already off the table
export function isWinShot(state: PoolGameState, finalPocketed: boolean[]): boolean {
  if (!finalPocketed[8]) return false;
  const group = state.playerGroups[state.activePlayerId];
  if (!group) return false;
  for (let i = 1; i <= 15; i++) {
    if (i === 8) continue;
    if (ballGroup(i) !== group) continue;
    if (state.activeBalls[i]) return false; // still on table before this shot
  }
  return true;
}

// Assign solid/stripe groups after first object ball is pocketed
export function assignGroups(
  state: PoolGameState,
  finalPocketed: boolean[],
  playerIds: string[],
): PoolGameState {
  if (state.groupAssigned) return state;
  let firstGroup: PoolGroup = null;
  for (let i = 1; i <= 15; i++) {
    if (i === 8) continue;
    if (finalPocketed[i]) {
      firstGroup = ballGroup(i);
      break;
    }
  }
  if (!firstGroup) return state;

  const opponent = playerIds.find(id => id !== state.activePlayerId) ?? playerIds[0];
  const opponentGroup: PoolGroup = firstGroup === 'solid' ? 'stripe' : 'solid';

  return {
    ...state,
    groupAssigned: true,
    playerGroups: {
      [state.activePlayerId]: firstGroup,
      [opponent]: opponentGroup,
    },
  };
}

// Process a completed shot and return the next game state.
// Caller must set state.cueBallPos to the final cue ball position from the recording
// before calling this (for non-scratch shots).
export function processShot(
  state: PoolGameState,
  result: PoolShotResult,
  playerIds: string[],
): PoolGameState {
  const { finalPocketed, cueBallPocketed } = result;
  const opponent = playerIds.find(id => id !== state.activePlayerId) ?? playerIds[0];
  const foul = isFoul(cueBallPocketed);

  // Update activeBalls — cue ball (index 0) always stays in play
  const newActiveBalls = state.activeBalls.map((a, i) => {
    if (i === 0) return true;
    return a && !finalPocketed[i];
  }) as boolean[];

  let next: PoolGameState = {
    ...state,
    activeBalls: newActiveBalls,
    shotCount: state.shotCount + 1,
    ballInHand: false,
  };

  // Assign groups from first pocketed object ball
  next = assignGroups(next, finalPocketed, playerIds);

  // 8-ball pocketed
  if (finalPocketed[8]) {
    if (isWinShot(state, finalPocketed) && !foul) {
      return { ...next, winner: state.activePlayerId, gameOver: true };
    }
    // Early 8-ball or 8-ball with scratch → lose
    return { ...next, winner: opponent, gameOver: true };
  }

  // Scratch: opponent gets ball-in-hand, cue ball reset to kitchen center
  if (foul) {
    return {
      ...next,
      activePlayerId: opponent,
      ballInHand: true,
      cueBallPos: [0, -0.686],
    };
  }

  // Pocketed at least one own ball — stay at table
  if (didPocketOwn(next, finalPocketed)) {
    return next;
  }

  // Miss or wrong group pocketed — turn passes
  return { ...next, activePlayerId: opponent };
}
