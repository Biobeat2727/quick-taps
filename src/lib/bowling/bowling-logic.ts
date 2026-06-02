// Pure bowling logic — no 'use client'. Safe to import on server and client.
import type { BowlingGameState } from '@/types/bowling';

// ── computeFrameScores ────────────────────────────────────────────────────────
// Takes a flat array of ball pin counts in throw order.
// Returns cumulative score per frame (null if bonus balls not yet thrown).

export function computeFrameScores(throws: number[]): (number | null)[] {
  const scores: (number | null)[] = Array(10).fill(null);
  let b = 0;
  let cumulative = 0;

  for (let f = 0; f < 10; f++) {
    const t0 = throws[b];
    if (t0 === undefined) break;

    if (f < 9) {
      if (t0 === 10) {
        // Strike
        const t1 = throws[b + 1];
        const t2 = throws[b + 2];
        if (t1 === undefined || t2 === undefined) break;
        cumulative += 10 + t1 + t2;
        scores[f] = cumulative;
        b += 1;
      } else {
        const t1 = throws[b + 1];
        if (t1 === undefined) break;
        if (t0 + t1 === 10) {
          // Spare
          const t2 = throws[b + 2];
          if (t2 === undefined) break;
          cumulative += 10 + t2;
          scores[f] = cumulative;
        } else {
          cumulative += t0 + t1;
          scores[f] = cumulative;
        }
        b += 2;
      }
    } else {
      // 10th frame — always sums all balls thrown
      const t1 = throws[b + 1];
      if (t1 === undefined) break;
      if (t0 === 10 || t0 + t1 === 10) {
        const t2 = throws[b + 2];
        if (t2 === undefined) break;
        cumulative += t0 + t1 + t2;
      } else {
        cumulative += t0 + t1;
      }
      scores[f] = cumulative;
    }
  }

  return scores;
}

// ── isFrameComplete ───────────────────────────────────────────────────────────

export function isFrameComplete(frameThrows: number[], frameIndex: number): boolean {
  if (frameIndex < 9) {
    return frameThrows.length >= 2 || frameThrows[0] === 10;
  }
  // 10th frame
  if (frameThrows.length < 2) return false;
  if (frameThrows[0] === 10 || frameThrows[0] + frameThrows[1] === 10) {
    return frameThrows.length >= 3;
  }
  return frameThrows.length >= 2;
}

// ── nextTurn ──────────────────────────────────────────────────────────────────
// Advances game state after a throw. knockedPins[i] = true means pin i was
// knocked during THIS throw (already filtered to standing-only by simulation).

export function nextTurn(
  state: BowlingGameState,
  knockedPins: boolean[],
  playerIds: string[],
): BowlingGameState {
  const { currentFrame, currentThrow, activePlayerId, throwHistory, pinState } = state;
  const knockedCount = knockedPins.filter(Boolean).length;

  // Update this player's throw history
  const existing = throwHistory[activePlayerId] ?? Array.from({ length: 10 }, () => [] as number[]);
  const playerFrames = existing.map((f, i) => i === currentFrame ? [...f, knockedCount] : [...f]);
  const newThrowHistory = { ...throwHistory, [activePlayerId]: playerFrames };

  const frameThrows = playerFrames[currentFrame];
  const frameComplete = isFrameComplete(frameThrows, currentFrame);

  if (frameComplete) {
    // Advance to next player, or next frame if all players done this frame
    const activeIndex = playerIds.indexOf(activePlayerId);
    const nextPlayerIndex = (activeIndex + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextPlayerIndex];
    const newFrame = nextPlayerIndex === 0 ? currentFrame + 1 : currentFrame;

    return {
      currentFrame: newFrame,
      currentThrow: 1,
      activePlayerId: nextPlayerId,
      pinState: Array(10).fill(true),
      throwHistory: newThrowHistory,
    };
  }

  // Frame continues — compute pin state for next throw
  const afterPinState = pinState.map((standing, i) => standing && !knockedPins[i]);
  let nextPinState = afterPinState;

  // 10th frame special: reset pins after a strike or spare mid-frame
  if (currentFrame === 9) {
    const [t1, t2] = frameThrows;
    if (currentThrow === 1 && t1 === 10) {
      // Strike on first ball of 10th → reset for ball 2
      nextPinState = Array(10).fill(true);
    } else if (currentThrow === 2) {
      if (t1 === 10 && t2 === 10) {
        // Double strike → reset for ball 3
        nextPinState = Array(10).fill(true);
      } else if (t1 !== 10 && t1 + t2 === 10) {
        // Spare → reset for ball 3
        nextPinState = Array(10).fill(true);
      }
      // Strike then open: keep remaining pins for ball 3
    }
  }

  return {
    currentFrame,
    currentThrow: currentThrow + 1,
    activePlayerId,
    pinState: nextPinState,
    throwHistory: newThrowHistory,
  };
}

// ── isGameComplete ────────────────────────────────────────────────────────────

export function isGameComplete(state: BowlingGameState, playerIds: string[]): boolean {
  return playerIds.every(id => {
    const frames = state.throwHistory[id] ?? [];
    return isFrameComplete(frames[9] ?? [], 9);
  });
}
