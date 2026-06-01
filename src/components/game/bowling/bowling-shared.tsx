'use client';

import type { BowlingRawRecording, BowlingDecodedRecording } from '@/types/bowling';

export type BowlingPhase = 'aiming' | 'throwing' | 'replay' | 'results';

export interface BowlingGameState {
  currentFrame: number;        // 0–9
  currentThrow: number;        // 1 or 2 (3 for 10th frame bonus)
  activePlayerId: string;
  pinState: boolean[];
  throwHistory: Record<string, number[][]>;  // playerId → frames → throws (pin counts)
}

// ── decodeRecording ────────────────────────────────────────────────────────────

export function decodeRecording(raw: BowlingRawRecording): BowlingDecodedRecording {
  const toBinary = (b64: string): ArrayBuffer => {
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
  };

  return {
    numFrames: raw.numFrames,
    ballFrames: new Float32Array(toBinary(raw.ballFramesBase64)),
    pinFrames: new Float32Array(toBinary(raw.pinFramesBase64)),
    knockedPins: raw.knockedPins,
  };
}

// ── computeFrameScores ─────────────────────────────────────────────────────────
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

// ── isFrameComplete ────────────────────────────────────────────────────────────

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

// ── nextTurn ───────────────────────────────────────────────────────────────────
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

// ── isGameComplete ─────────────────────────────────────────────────────────────

export function isGameComplete(state: BowlingGameState, playerIds: string[]): boolean {
  return playerIds.every(id => {
    const frames = state.throwHistory[id] ?? [];
    return isFrameComplete(frames[9] ?? [], 9);
  });
}

// ── throwSymbol helper ─────────────────────────────────────────────────────────

function throwSymbol(frameThrows: number[], ballIdx: number, frameIndex: number): string {
  const val = frameThrows[ballIdx];
  if (val === undefined) return '';
  if (val === 0) return '\u2013'; // en-dash for gutter

  if (frameIndex < 9) {
    if (ballIdx === 0) return val === 10 ? 'X' : String(val);
    return frameThrows[0] + val === 10 ? '/' : String(val);
  }

  // 10th frame
  if (ballIdx === 0) return val === 10 ? 'X' : String(val);
  if (ballIdx === 1) {
    if (frameThrows[0] === 10) return val === 10 ? 'X' : String(val); // fresh set after strike
    return frameThrows[0] + val === 10 ? '/' : String(val);
  }
  // ball 3
  if (frameThrows[0] === 10 && frameThrows[1] === 10) return val === 10 ? 'X' : String(val);
  if (frameThrows[0] === 10) return frameThrows[1] + val === 10 ? '/' : String(val); // spare after strike
  return val === 10 ? 'X' : String(val); // spare on balls 1+2 → fresh pins for ball 3
}

// ── ScoreCard ──────────────────────────────────────────────────────────────────

export function ScoreCard({
  playerName = '',
  frameThrows,
  activeFrame,
  cumScores,
}: {
  playerName?: string;
  frameThrows: number[][];
  activeFrame: number;
  cumScores: (number | null)[];
}) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#fff' }}>
      {playerName && (
        <div style={{ fontSize: 11, color: '#bbb', marginBottom: 3, fontWeight: 600 }}>
          {playerName}
        </div>
      )}
      <div style={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: 10 }, (_, f) => {
          const ft = frameThrows[f] ?? [];
          const score = cumScores[f];
          const isActive = f === activeFrame;
          const isFuture = f > activeFrame;
          const slotCount = f < 9 ? 2 : 3;

          return (
            <div
              key={f}
              style={{
                border: `1px solid ${isActive ? '#F0C040' : '#444'}`,
                borderRadius: 3,
                minWidth: f < 9 ? 28 : 44,
                background: isFuture ? '#0a0a0a' : isActive ? '#1e1800' : '#161616',
                opacity: isFuture ? 0.4 : 1,
                flexShrink: 0,
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'flex-end',
                borderBottom: '1px solid #2a2a2a', padding: '1px 2px', gap: 1,
              }}>
                {Array.from({ length: slotCount }, (_, i) => {
                  const sym = throwSymbol(ft, i, f);
                  return (
                    <span
                      key={i}
                      style={{
                        fontSize: 9, fontWeight: 700, width: 12, textAlign: 'center',
                        lineHeight: '14px',
                        color: sym === 'X' ? '#EF9F27' : sym === '/' ? '#7bc8ff' : '#ddd',
                      }}
                    >
                      {sym}
                    </span>
                  );
                })}
              </div>
              <div style={{
                fontSize: 10, textAlign: 'center', padding: '2px 1px',
                minHeight: 16, color: isActive ? '#F0C040' : '#ddd', fontWeight: 700,
              }}>
                {score !== null ? score : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BowlingResultsScreen ───────────────────────────────────────────────────────

export function BowlingResultsScreen({
  players,
  throwHistory,
  onBowlAgain,
  onLeave,
}: {
  players: { id: string; name: string }[];
  throwHistory: Record<string, number[][]>;
  onBowlAgain: () => void;
  onLeave: () => void;
}) {
  const results = players
    .map(p => {
      const frames = throwHistory[p.id] ?? [];
      const scores = computeFrameScores(frames.flat());
      return { ...p, total: scores[9] ?? 0, frames, scores };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <main
      style={{
        minHeight: '100dvh', background: '#1C1B16', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 16px 48px', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 900, color: '#EF9F27', margin: '0 0 24px' }}>
        Game Over!
      </h1>

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.map((p, i) => (
          <div
            key={p.id}
            style={{
              background: i === 0 ? '#2a2200' : '#222',
              border: `1px solid ${i === 0 ? '#F0C040' : '#444'}`,
              borderRadius: 8, padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: i === 0 ? '#F0C040' : '#fff' }}>
                {i + 1}. {p.name}
              </span>
              <span style={{ fontSize: 24, fontWeight: 900, color: i === 0 ? '#F0C040' : '#fff' }}>
                {p.total}
              </span>
            </div>
            <ScoreCard
              frameThrows={p.frames}
              activeFrame={10}
              cumScores={p.scores}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 40, display: 'flex', gap: 12 }}>
        <button
          onClick={onBowlAgain}
          style={{
            background: '#EF9F27', color: '#1C1B16', border: 'none',
            borderRadius: 8, padding: '12px 24px', fontSize: 16,
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          Bowl Again
        </button>
        <button
          onClick={onLeave}
          style={{
            background: 'transparent', color: '#aaa', border: '1px solid #555',
            borderRadius: 8, padding: '12px 24px', fontSize: 16, cursor: 'pointer',
          }}
        >
          Leave
        </button>
      </div>
    </main>
  );
}
