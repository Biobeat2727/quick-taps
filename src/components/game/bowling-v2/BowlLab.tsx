'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { runBowlSim, type BowlThrow } from '@/lib/bowling/bowl-sim-core';
import { computeFrameScores, nextTurn, isGameComplete } from '@/lib/bowling/bowling-logic';
import type { BowlingGameState } from '@/types/bowling';
import { BowlScene, playbackEndFrame, type Hype, type Playback } from './BowlScene';
import { useSwipeThrow, type SwipeResult } from './useSwipeThrow';

const PID = 'me';
const MAX_AIM_X = 0.45;

let rapierP: Promise<typeof RAPIER_T> | null = null;
function loadRapier() {
  rapierP ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = (m.default ?? m) as typeof RAPIER_T;
    await R.init();
    return R;
  });
  return rapierP;
}

function freshState(): BowlingGameState {
  return {
    currentFrame: 0, currentThrow: 1, activePlayerId: PID,
    pinState: Array(10).fill(true),
    throwHistory: { [PID]: Array.from({ length: 10 }, () => [] as number[]) },
  };
}

type Callout = { text: string; tone: 'strike' | 'spare' | 'gutter' | 'count' } | null;

// ── Scorecard ──────────────────────────────────────────────────────────────

function marks(ft: number[], idx: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < ft.length; i++) {
    const v = ft[i];
    const prev = ft[i - 1];
    const tenthFresh = idx === 9 && (i === 0 || prev === 10 || (i === 2 && ft[0] + ft[1] === 10 && ft[0] !== 10));
    if (v === 10 && (i === 0 || tenthFresh)) out.push('X');
    else if (i > 0 && !tenthFresh && prev + v === 10) out.push('/');
    else out.push(v === 0 ? '–' : String(v));
  }
  return out;
}

function Scorecard({ state }: { state: BowlingGameState }) {
  const frames = state.throwHistory[PID];
  const cum = computeFrameScores(frames.flat());
  return (
    <div className="flex gap-[3px] w-full">
      {frames.map((ft, i) => {
        const m = marks(ft, i);
        const active = i === state.currentFrame;
        return (
          <div
            key={i}
            className="flex-1 min-w-0 rounded-md border text-center"
            style={{
              borderColor: active ? '#ff3fd0' : 'rgba(180,140,255,0.18)',
              background: active ? 'rgba(255,63,208,0.12)' : 'rgba(12,6,24,0.55)',
              boxShadow: active ? '0 0 12px rgba(255,63,208,0.5)' : undefined,
              flexGrow: i === 9 ? 1.4 : 1,
            }}
          >
            <div className="text-[9px] leading-3 pt-0.5" style={{ color: 'rgba(200,180,255,0.45)' }}>{i + 1}</div>
            <div className="text-[11px] leading-4 font-bold tracking-tight h-4" style={{ color: '#9bf6ff' }}>
              {m.join(' ')}
            </div>
            <div className="text-[12px] leading-4 pb-0.5 font-display" style={{ color: '#fff3d6' }}>
              {cum[i] ?? ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Lab ────────────────────────────────────────────────────────────────────

export function BowlLab() {
  const [game, setGame] = useState<BowlingGameState>(freshState);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [throwId, setThrowId] = useState(0);
  const [callout, setCallout] = useState<Callout>(null);
  const [ready, setReady] = useState(false);
  const [over, setOver] = useState(false);
  const [release, setRelease] = useState<{ mph: string; hook: string } | null>(null);
  const rapier = useRef<typeof RAPIER_T | null>(null);
  const aimXRef = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const gameRef = useRef(game);
  useLayoutEffect(() => { gameRef.current = game; }, [game]);
  const pending = useRef<{ knocked: boolean[]; hype: Hype } | null>(null);

  useEffect(() => { loadRapier().then((R) => { rapier.current = R; setReady(true); }); }, []);

  const bowl = useCallback((t: Omit<BowlThrow, 'pinState'>) => {
    const R = rapier.current;
    if (!R || playback) return;
    const pinState = gameRef.current.pinState;
    const sim = runBowlSim(R, { ...t, pinState });
    const standing = pinState.filter(Boolean).length;
    const knocked = sim.knockedPins.filter(Boolean).length;
    const hype: Hype =
      knocked === 10 ? 'strike'
      : knocked === standing && standing > 0 ? 'big'
      : knocked >= 7 ? 'big'
      : sim.impactFrame < 0 ? 'gutter'
      : 'normal';
    pending.current = { knocked: sim.knockedPins, hype };
    // Readout like an alley's speed display. World spin is mirrored vs. the screen.
    const screenSpin = -t.spin;
    setRelease({
      mph: (t.speed * 2.237).toFixed(1),
      hook: Math.abs(screenSpin) < 0.05 ? 'STRAIGHT' : `HOOK ${screenSpin > 0 ? '→' : '←'}`,
    });
    setThrowId((n) => n + 1);
    setPlayback({ sim, endFrame: playbackEndFrame(sim), hype });
  }, [playback]);

  const onSwipe = useCallback((r: SwipeResult) => {
    // Camera looks down +Z, so screen-right is world −X.
    bowl({ startX: -r.aim * MAX_AIM_X, direction: -r.direction, speed: r.speed, spin: -r.spin });
  }, [bowl]);

  useSwipeThrow(
    surface,
    ready && !playback && !over,
    (aim) => { aimXRef.current = -aim * MAX_AIM_X; },
    onSwipe,
  );

  const onImpact = useCallback(() => {
    const h = pending.current?.hype;
    try { navigator.vibrate?.(h === 'strike' ? [40, 30, 70] : h === 'big' ? 35 : 18); } catch {}
  }, []);

  const onEnd = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    const g = gameRef.current;
    const standing = g.pinState.filter(Boolean).length;
    const n = p.knocked.filter(Boolean).length;
    const firstBall = standing === 10;
    const c: Callout =
      n === 10 && firstBall ? { text: 'STRIKE!', tone: 'strike' }
      : n === standing && n > 0 ? { text: 'SPARE!', tone: 'spare' }
      : n === 0 ? { text: p.hype === 'gutter' ? 'GUTTER' : 'MISS', tone: 'gutter' }
      : { text: String(n), tone: 'count' };
    setCallout(c);
    const next = nextTurn(g, p.knocked, [PID]);
    setTimeout(() => {
      pending.current = null;
      setCallout(null);
      setGame(next);
      setPlayback(null);
      setRelease(null);
      if (isGameComplete(next, [PID])) setOver(true);
    }, c.tone === 'strike' ? 1900 : 1300);
  }, []);

  // Dev hook for scripted throws: window.__bowl({ startX, direction, speed, spin })
  useEffect(() => {
    (window as unknown as { __bowl?: unknown }).__bowl = bowl;
  }, [bowl]);

  const total = computeFrameScores(game.throwHistory[PID].flat()).filter((v) => v != null).pop() ?? 0;

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: '#07040c' }}>
      <BowlScene
        aimXRef={aimXRef}
        playback={playback}
        pinState={game.pinState}
        throwId={throwId}
        onImpact={onImpact}
        onEnd={onEnd}
      />
      <div ref={surface} className="absolute inset-0" style={{ touchAction: 'none' }} />

      {/* HUD */}
      <div className="absolute top-0 inset-x-0 px-3 pointer-events-none" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex items-baseline justify-between mb-1.5 px-0.5">
          <span className="font-display text-[13px] tracking-wider" style={{ color: '#ff9ae8', textShadow: '0 0 10px #ff3fd0' }}>
            FRAME {Math.min(10, game.currentFrame + 1)}
          </span>
          <span className="font-display text-[20px]" style={{ color: '#fff3d6', textShadow: '0 0 12px #ffb424' }}>{total}</span>
        </div>
        <Scorecard state={game} />
      </div>

      {release && (
        <div className="absolute inset-x-0 text-center pointer-events-none" style={{ top: 'calc(max(10px, env(safe-area-inset-top)) + 96px)' }}>
          <span className="font-display text-[22px]" style={{ color: '#eaffff', textShadow: '0 0 10px #3ff2ff' }}>{release.mph}</span>
          <span className="text-[11px] tracking-[0.2em] ml-1" style={{ color: 'rgba(210,195,255,0.7)' }}>MPH</span>
          <div className="text-[10px] tracking-[0.3em] mt-0.5" style={{ color: 'rgba(255,154,232,0.8)' }}>{release.hook}</div>
        </div>
      )}

      {!playback && !over && ready && (
        <div className="absolute inset-x-0 text-center pointer-events-none bowl-hint" style={{ bottom: 'max(28px, env(safe-area-inset-bottom))' }}>
          <p className="text-[12px] tracking-[0.22em] uppercase" style={{ color: 'rgba(210,195,255,0.75)' }}>
            Drag to line up · Flick up to bowl
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'rgba(210,195,255,0.45)' }}>Bend your flick hard to hook it</p>
        </div>
      )}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-display text-lg animate-pulse" style={{ color: '#ff9ae8' }}>Racking pins…</span>
        </div>
      )}

      {callout && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span key={throwId} className={`bowl-callout bowl-callout-${callout.tone} font-display`}>{callout.text}</span>
        </div>
      )}

      {over && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5" style={{ background: 'rgba(7,4,12,0.72)' }}>
          <p className="text-[11px] tracking-[0.35em] uppercase" style={{ color: 'rgba(210,195,255,0.6)' }}>Final score</p>
          <p className="font-display text-7xl bowl-callout-strike" style={{ animation: 'none' }}>{total}</p>
          <button
            className="btn-amber rounded-2xl px-8 py-4 font-bold uppercase tracking-wide active:scale-95 transition-transform"
            onClick={() => { setGame(freshState()); setOver(false); }}
          >
            Bowl again
          </button>
        </div>
      )}

      <style>{`
        .bowl-hint { animation: bowlHint 2.4s ease-in-out infinite; }
        @keyframes bowlHint { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
        .bowl-callout { font-size: 64px; letter-spacing: .02em; animation: bowlIn .9s cubic-bezier(.2,1.4,.3,1) both; }
        .bowl-callout-strike { color: #fff0fb; text-shadow: 0 0 6px #fff, 0 0 18px #ff3fd0, 0 0 42px #ff3fd0, 0 0 80px #b44bff; font-size: 76px; }
        .bowl-callout-spare { color: #eaffff; text-shadow: 0 0 6px #fff, 0 0 18px #3ff2ff, 0 0 42px #3ff2ff; }
        .bowl-callout-gutter { color: #8e86a0; text-shadow: 0 0 10px rgba(142,134,160,.5); font-size: 44px; }
        .bowl-callout-count { color: #fff3d6; text-shadow: 0 0 10px #ffb424, 0 0 30px #ffb424; font-size: 88px; }
        @keyframes bowlIn {
          0% { transform: scale(2.4); opacity: 0; filter: blur(8px) }
          18% { opacity: 1; filter: blur(0) }
          24% { opacity: .35 } 30% { opacity: 1 } 36% { opacity: .6 } 42% { opacity: 1 }
          100% { transform: scale(1); opacity: 1 }
        }
      `}</style>
    </div>
  );
}
