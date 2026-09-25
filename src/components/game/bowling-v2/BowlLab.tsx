'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { runBowlSim, type BowlThrow, type BowlSimResult } from '@/lib/bowling/bowl-sim-core';
import { computeFrameScores, nextTurn, isGameComplete } from '@/lib/bowling/bowling-logic';
import { f32ToB64, b64ToF32 } from '@/lib/match/codec';
import type { MatchNet, MatchEvent } from '@/lib/match/useMatch';
import type { BowlingMatch, BowlRecording, BowlShotPayload, MatchPlayer } from '@/types/match';
import type { BowlingGameState } from '@/types/bowling';
import { BowlScene, playbackEndFrame, type Hype, type Playback } from './BowlScene';
import { useSwipeThrow, type SwipeResult } from './useSwipeThrow';
import { ShotClock } from '../ShotClock';
import { SoundToggle } from '../SoundToggle';
import { bowlSfx, type Rumble } from '@/lib/audio/sfx';
import { SHOT_CLOCK_MS } from '@/lib/match/shot-clock';

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

function freshState(ids: string[]): BowlingGameState {
  return {
    currentFrame: 0, currentThrow: 1, activePlayerId: ids[0],
    pinState: Array(10).fill(true),
    throwHistory: Object.fromEntries(ids.map((id) => [id, Array.from({ length: 10 }, () => [] as number[])])),
  };
}

type Callout = { text: string; tone: 'strike' | 'spare' | 'gutter' | 'count'; who?: string } | null;

const totalOf = (s: BowlingGameState, id: string) =>
  computeFrameScores((s.throwHistory[id] ?? []).flat()).filter((v) => v != null).pop() ?? 0;

function hypeFor(knocked: boolean[], pinState: boolean[], impactFrame: number): Hype {
  const standing = pinState.filter(Boolean).length;
  const n = knocked.filter(Boolean).length;
  return n === 10 ? 'strike' : n === standing && standing > 0 ? 'big' : n >= 7 ? 'big' : impactFrame < 0 ? 'gutter' : 'normal';
}

const hookLabel = (worldSpin: number) => {
  const screenSpin = -worldSpin; // camera looks down +Z: world spin is mirrored on screen
  return Math.abs(screenSpin) < 0.05 ? 'STRAIGHT' : `HOOK ${screenSpin > 0 ? '→' : '←'}`;
};

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

function Scorecard({ state, playerId }: { state: BowlingGameState; playerId: string }) {
  const frames = state.throwHistory[playerId] ?? [];
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
            <div className="text-[11px] leading-4 font-bold tracking-tight h-4" style={{ color: '#9bf6ff' }}>{m.join(' ')}</div>
            <div className="text-[12px] leading-4 pb-0.5 font-display" style={{ color: '#fff3d6' }}>{cum[i] ?? ''}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Game ───────────────────────────────────────────────────────────────────

export interface BowlGameProps {
  players: MatchPlayer[];
  meId: string;
  hostId: string;
  initial: BowlingGameState;
  initialSeq?: number;
  /** Online play. Absent = solo lab. */
  net?: MatchNet<BowlingMatch>;
  sync?: { seq: number; state: BowlingGameState; players: MatchPlayer[]; force?: boolean };
  /** Shot-clock deadline for the current turn (local ms), online only. */
  deadline?: number | null;
  onLeave?: () => void;
}

/** Solo lab: one bowler, no network. */
export function BowlLab() {
  const [initial] = useState(() => freshState(['me']));
  return <BowlGame players={[{ id: 'me', name: 'You', color: '#ff3fd0', isNpc: false }]} meId="me" hostId="me" initial={initial} />;
}

export function BowlGame({ players: initialPlayers, meId, hostId, initial, initialSeq = 0, net, sync, deadline, onLeave }: BowlGameProps) {
  const [players, setPlayers] = useState(initialPlayers);
  const [game, setGame] = useState<BowlingGameState>(initial);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [throwId, setThrowId] = useState(0);
  const [callout, setCallout] = useState<Callout>(null);
  const [ready, setReady] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [release, setRelease] = useState<{ mph: string; hook: string; who: string } | null>(null);
  const rapier = useRef<typeof RAPIER_T | null>(null);
  const aimXRef = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const gameRef = useRef(game);
  useLayoutEffect(() => { gameRef.current = game; }, [game]);
  const playersRef = useRef(players);
  useLayoutEffect(() => { playersRef.current = players; }, [players]);
  const seqRef = useRef(initialSeq);
  const pending = useRef<{ knocked: boolean[]; hype: Hype; next?: BowlingGameState; who: string } | null>(null);

  const ids = players.map((p) => p.id);
  const over = isGameComplete(game, ids);
  const myTurn = !playback && !remoteBusy && !over && game.activePlayerId === meId;
  const nameOf = (id: string) => (id === meId ? 'You' : players.find((p) => p.id === id)?.name ?? '—');

  useEffect(() => { loadRapier().then((R) => { rapier.current = R; setReady(true); }); }, []);

  // The ball's roll: starts on release, stops when it reaches the pins
  const rollRef = useRef<Rumble | null>(null);
  useEffect(() => () => rollRef.current?.stop(0.05), []);

  const startPlayback = useCallback((sim: BowlSimResult, hype: Hype, speed: number, spin: number, who: string) => {
    rollRef.current?.stop(0.05);
    rollRef.current = bowlSfx.roll(speed);
    setRelease({ mph: (speed * 2.237).toFixed(1), hook: hookLabel(spin), who });
    setThrowId((n) => n + 1);
    setPlayback({ sim, endFrame: playbackEndFrame(sim), hype });
  }, []);

  const bowl = useCallback((t: Omit<BowlThrow, 'pinState'>) => {
    const R = rapier.current;
    if (!R || playback || pending.current) return;
    const g = gameRef.current;
    const sim = runBowlSim(R, { ...t, pinState: g.pinState });
    const hype = hypeFor(sim.knockedPins, g.pinState, sim.impactFrame);
    pending.current = { knocked: sim.knockedPins, hype, who: meId };
    if (net) {
      const rec: BowlRecording = {
        numFrames: sim.numFrames, ball: f32ToB64(sim.ballFrames), pins: f32ToB64(sim.pinFrames),
        impactFrame: sim.impactFrame, gutterFrame: sim.gutterFrame, knocked: sim.knockedPins, speed: t.speed, spin: t.spin,
      };
      const payload: BowlShotPayload = { knocked: sim.knockedPins, speed: t.speed, spin: t.spin, rec };
      void net.submit(seqRef.current, payload);
    }
    seqRef.current += 1;
    startPlayback(sim, hype, t.speed, t.spin, meId);
  }, [playback, net, meId, startPlayback]);

  const onSwipe = useCallback((r: SwipeResult) => {
    bowl({ startX: -r.aim * MAX_AIM_X, direction: -r.direction, speed: r.speed, spin: -r.spin });
  }, [bowl]);

  useSwipeThrow(surface, ready && myTurn, (aim) => { aimXRef.current = -aim * MAX_AIM_X; }, onSwipe);

  const onImpact = useCallback(() => {
    const h = pending.current?.hype;
    rollRef.current?.stop(0.35);
    bowlSfx.pins(pending.current?.knocked.filter(Boolean).length ?? 0, h === 'strike');
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
    setCallout({ ...c!, who: p.who === meId ? undefined : nameOf(p.who) });
    rollRef.current?.stop(0.2);
    if (c.tone === 'strike') bowlSfx.strike();
    else if (c.tone === 'spare') bowlSfx.spare();
    else if (c.tone === 'gutter') { if (p.hype === 'gutter') bowlSfx.gutter(); bowlSfx.miss(); }
    // Remote throws carry the server's next state; my own apply the same rules locally
    const next = p.next ?? nextTurn(g, p.knocked, playersRef.current.map((q) => q.id));
    setTimeout(() => {
      pending.current = null;
      setCallout(null);
      setGame(next);
      setPlayback(null);
      setRelease(null);
      setRemoteBusy(false);
      queueMicrotask(() => pumpRef.current());
    }, c!.tone === 'strike' ? 1900 : 1300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  // ── Online: other bowlers' throws arrive as events; play them in order ──
  const queue = useRef<MatchEvent<BowlingMatch>[]>([]);
  const pumping = useRef(false);
  const pumpRef = useRef<() => void>(() => {});
  pumpRef.current = async () => {
    if (!net || pumping.current || pending.current) return;
    const e = queue.current.shift();
    if (!e) return;
    pumping.current = true;
    try {
      if (e.type === 'update' && e.reason === 'timeout' && e.match.seq < seqRef.current) {
        // a late-arriving timeout we've already moved past
      } else if (e.type === 'update') {
        setPlayers(e.match.players);
        setGame(e.match.state);
        seqRef.current = e.match.seq;
        if (e.reason === 'timeout' && e.actorId) {
          const c: Callout = { text: 'TIME!', tone: 'gutter', who: e.actorId === meId ? undefined : nameOf(e.actorId) };
          setCallout(c);
          setTimeout(() => setCallout((cur) => (cur === c ? null : cur)), 1800);
        }
      } else if (e.seq < seqRef.current) {
        // my own throw — already played
      } else if (e.seq > seqRef.current) {
        setPlayers(e.match.players);
        setGame(e.match.state);
        seqRef.current = e.match.seq;
      } else {
        setRemoteBusy(true);
        const rec = await net.fetchRec<BowlRecording>(e.seq);
        seqRef.current = e.seq + 1;
        if (!rec) { setGame(e.match.state); setRemoteBusy(false); }
        else {
          const g = gameRef.current;
          const sim: BowlSimResult = {
            numFrames: rec.numFrames, ballFrames: b64ToF32(rec.ball), pinFrames: b64ToF32(rec.pins),
            knockedPins: rec.knocked, impactFrame: rec.impactFrame, gutterFrame: rec.gutterFrame,
          };
          const hype = hypeFor(rec.knocked, g.pinState, rec.impactFrame);
          pending.current = { knocked: rec.knocked, hype, next: e.match.state, who: e.actorId };
          startPlayback(sim, hype, rec.speed, rec.spin, e.actorId);
        }
      }
    } finally {
      pumping.current = false;
      if (!pending.current) pumpRef.current();
    }
  };
  useEffect(() => {
    if (!net) return;
    return net.subscribe((e) => { queue.current.push(e); pumpRef.current(); });
  }, [net]);

  // Server truth from a reload, applied once any playback has finished. `force`
  // means the server refused our throw (e.g. the clock ran out first), so it
  // replaces our optimistic state even at the same seq.
  const appliedSync = useRef(sync);
  useEffect(() => {
    if (!sync || sync === appliedSync.current || pending.current || playback) return;
    appliedSync.current = sync;
    if (sync.seq === seqRef.current && !sync.force) return;
    seqRef.current = sync.seq;
    setPlayers(sync.players);
    setGame(sync.state);
  }, [sync, playback]);

  // Dev hook for scripted throws: window.__bowl({ startX, direction, speed, spin })
  useEffect(() => {
    (window as unknown as { __bowl?: unknown }).__bowl = bowl;
  }, [bowl]);

  const active = game.activePlayerId;
  const featured = myTurn || !players.some((p) => p.id === active) ? meId : active;
  const standings = [...players].sort((a, b) => totalOf(game, b.id) - totalOf(game, a.id));

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

      <SoundToggle className="absolute left-2 z-20" style={{ top: `calc(max(10px, env(safe-area-inset-top)) + ${players.length > 1 ? 118 : 88}px)` }} />

      {/* HUD: the current bowler's card, plus everyone's running totals */}
      <div className="absolute top-0 inset-x-0 px-3 pointer-events-none" style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <div className="flex items-baseline justify-between mb-1.5 px-0.5">
          <span className="font-display text-[13px] tracking-wider truncate" style={{ color: '#ff9ae8', textShadow: '0 0 10px #ff3fd0' }}>
            {players.length > 1 ? `${nameOf(featured).toUpperCase()} · ` : ''}FRAME {Math.min(10, game.currentFrame + 1)}
          </span>
          <span className="font-display text-[20px]" style={{ color: '#fff3d6', textShadow: '0 0 12px #ffb424' }}>{totalOf(game, featured)}</span>
        </div>
        <Scorecard state={game} playerId={featured} />
        {players.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {players.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{
                background: p.id === active ? 'rgba(255,63,208,0.18)' : 'rgba(12,6,24,0.6)',
                border: `1px solid ${p.id === active ? 'rgba(255,63,208,0.7)' : 'rgba(180,140,255,0.2)'}`,
                color: '#f5eddf',
              }}>
                <span className="w-2 h-2 rounded-full" style={{ background: p.color, boxShadow: `0 0 6px ${p.color}` }} />
                {p.id === meId ? 'You' : p.name}
                <span className="font-display" style={{ color: '#fff3d6' }}>{totalOf(game, p.id)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {release && (
        <div className="absolute inset-x-0 text-center pointer-events-none" style={{ top: `calc(max(10px, env(safe-area-inset-top)) + ${players.length > 1 ? 128 : 96}px)` }}>
          <span className="font-display text-[22px]" style={{ color: '#eaffff', textShadow: '0 0 10px #3ff2ff' }}>{release.mph}</span>
          <span className="text-[11px] tracking-[0.2em] ml-1" style={{ color: 'rgba(210,195,255,0.7)' }}>MPH</span>
          <div className="text-[10px] tracking-[0.3em] mt-0.5" style={{ color: 'rgba(255,154,232,0.8)' }}>{release.hook}</div>
        </div>
      )}

      {!playback && !over && ready && (
        <div className="absolute inset-x-0 text-center pointer-events-none bowl-hint" style={{ bottom: 'max(28px, env(safe-area-inset-bottom))' }}>
          <div className="flex justify-center mb-2">
            <ShotClock
              deadline={deadline}
              maxMs={SHOT_CLOCK_MS.bowling}
              mine={active === meId}
              who={nameOf(active)}
              visible={!!net && !remoteBusy}
            />
          </div>
          {myTurn ? (
            <>
              <p className="text-[12px] tracking-[0.22em] uppercase" style={{ color: 'rgba(210,195,255,0.75)' }}>
                {players.length > 1 ? 'Your turn · ' : ''}Drag to line up · Flick up to bowl
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'rgba(210,195,255,0.45)' }}>Bend your flick hard to hook it</p>
            </>
          ) : (
            <p className="text-[12px] tracking-[0.22em] uppercase" style={{ color: 'rgba(255,154,232,0.85)' }}>
              {nameOf(active)} is up…
            </p>
          )}
        </div>
      )}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-display text-lg animate-pulse" style={{ color: '#ff9ae8' }}>Racking pins…</span>
        </div>
      )}

      {callout && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {callout.who && <span className="text-[12px] tracking-[0.3em] uppercase mb-1" style={{ color: 'rgba(230,220,255,0.85)' }}>{callout.who}</span>}
          <span key={throwId} className={`bowl-callout bowl-callout-${callout.tone} font-display`}>{callout.text}</span>
        </div>
      )}

      {over && !playback && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6" style={{ background: 'rgba(7,4,12,0.78)' }}>
          <p className="text-[11px] tracking-[0.35em] uppercase" style={{ color: 'rgba(210,195,255,0.6)' }}>Final score{players.length > 1 ? 's' : ''}</p>
          {players.length === 1 ? (
            <p className="font-display text-7xl bowl-callout-strike" style={{ animation: 'none' }}>{totalOf(game, players[0].id)}</p>
          ) : (
            <div className="w-full max-w-xs flex flex-col gap-2">
              {standings.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl px-4 py-2" style={{
                  background: i === 0 ? 'rgba(255,63,208,0.16)' : 'rgba(12,6,24,0.7)',
                  border: `1px solid ${i === 0 ? 'rgba(255,63,208,0.7)' : 'rgba(180,140,255,0.2)'}`,
                }}>
                  <span className="font-display text-[15px]" style={{ color: '#f5eddf' }}>{i === 0 ? '👑 ' : `${i + 1}. `}{p.id === meId ? 'You' : p.name}</span>
                  <span className="font-display text-[22px]" style={{ color: '#fff3d6', textShadow: '0 0 10px #ffb424' }}>{totalOf(game, p.id)}</span>
                </div>
              ))}
            </div>
          )}
          {!net ? (
            <button className="btn-amber rounded-2xl px-8 py-4 font-bold uppercase tracking-wide active:scale-95 transition-transform"
              onClick={() => setGame(freshState(players.map((p) => p.id)))}>
              Bowl again
            </button>
          ) : meId === hostId ? (
            <button className="btn-amber rounded-2xl px-8 py-4 font-bold uppercase tracking-wide active:scale-95 transition-transform"
              onClick={() => { void net.rematch(); }}>
              Bowl again
            </button>
          ) : (
            <p className="text-[12px] tracking-[0.2em] uppercase" style={{ color: 'rgba(210,195,255,0.8)' }}>
              Waiting for {players.find((q) => q.id === hostId)?.name ?? 'the host'} to start another…
            </p>
          )}
          {onLeave && (
            <button className="text-[12px] tracking-[0.2em] uppercase underline underline-offset-4" style={{ color: 'rgba(210,195,255,0.7)' }} onClick={onLeave}>
              Leave lane
            </button>
          )}
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
