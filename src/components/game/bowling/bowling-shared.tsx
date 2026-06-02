'use client';

import type { BowlingRawRecording, BowlingDecodedRecording } from '@/types/bowling';
import { computeFrameScores } from '@/lib/bowling/bowling-logic';

// Re-export types and logic so existing imports (bowl-test/page.tsx etc.) still work
export type { BowlingGameState } from '@/types/bowling';
export { computeFrameScores, isFrameComplete, nextTurn, isGameComplete } from '@/lib/bowling/bowling-logic';

export type BowlingPhase = 'aiming' | 'throwing' | 'replay' | 'results';

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
    if (frameThrows[0] === 10) return val === 10 ? 'X' : String(val);
    return frameThrows[0] + val === 10 ? '/' : String(val);
  }
  // ball 3
  if (frameThrows[0] === 10 && frameThrows[1] === 10) return val === 10 ? 'X' : String(val);
  if (frameThrows[0] === 10) return frameThrows[1] + val === 10 ? '/' : String(val);
  return val === 10 ? 'X' : String(val);
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
