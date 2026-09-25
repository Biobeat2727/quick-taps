'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BALL_RADIUS as R, simulatePoolShot, HEAD_SPOT, type PoolShot, type PoolTable, type PoolSimResult } from '@/lib/pool/pool-sim-core';
import { newGame, applyShot, legalTargets, canPlaceCue, groupOf, type PoolState, type PoolCall } from '@/lib/pool/pool-rules';
import { f32ToB64, b64ToF32 } from '@/lib/match/codec';
import type { MatchNet, MatchEvent } from '@/lib/match/useMatch';
import type { PoolMatch, PoolRecording, PoolShotPayload } from '@/types/match';
import { planBotShot } from '@/lib/pool/pool-bot';
import { NPC_NAMES } from '@/lib/constants';
import { PoolScene, type AimState, type PoolPlayback, type ScreenApi } from './PoolScene';
import { ballHue } from './poolTextures';
import { SpinBadge, SpinPicker, type Spin } from './SpinPicker';
import { ShotClock } from '../ShotClock';
import { SoundToggle } from '../SoundToggle';
import { TonightRank } from '@/components/leaderboard/TonightRank';
import { poolSfx, bowlSfx, marbleSfx } from '@/lib/audio/sfx';
import { SHOT_CLOCK_MS } from '@/lib/match/shot-clock';

type V = [number, number];
const BOT_SKILL = 0.6;
const TOP_INSET = 58;         // px kept clear above the table (player chips)
const BOTTOM_INSET = 156;     // px kept clear below it (spin, fine aim, slide-to-shoot)
const TRAY_W = 24;             // px gutter on the left for the pocketed-ball return
const INSETS = { top: TOP_INSET, bottom: BOTTOM_INSET, left: TRAY_W, right: 0 };
const MAX_SPEED = 8.6;

type Callout = { text: string; sub?: string; tone: 'good' | 'bad' | 'info' | 'big' } | null;

function describe(call: PoolCall | null, shooter: number, names: string[], groupsNow: PoolState['groups'], me: number): Callout {
  if (!call) return null;
  const who = names[shooter];
  switch (call.kind) {
    case 'foul': {
      const t = call.reason === 'scratch' ? 'SCRATCH' : call.reason === 'no-hit' ? 'NO HIT' : call.reason === 'timeout' ? 'SHOT CLOCK' : 'WRONG BALL';
      return { text: t, sub: 1 - shooter === me ? 'You have ball in hand' : `${names[1 - shooter]} has ball in hand`, tone: 'bad' };
    }
    case 'claim':
      return { text: shooter === me ? `YOU'RE ${call.group === 'solid' ? 'SOLIDS' : 'STRIPES'}` : `${who.toUpperCase()} IS ${call.group === 'solid' ? 'SOLIDS' : 'STRIPES'}`, tone: 'info' };
    case 'pot': {
      const own = groupsNow ? call.balls.filter((b) => groupOf(b) === groupsNow[shooter]).length : call.balls.length;
      if (own >= 2) return { text: own === 2 ? 'DOUBLE!' : 'TRIPLE!', tone: 'good' };
      return null;
    }
    case 'win': return { text: shooter === me ? 'YOU WIN!' : `${who.toUpperCase()} WINS`, tone: 'big' };
    case 'loss': return {
      text: shooter === me ? 'YOU LOSE' : `${who.toUpperCase()} SCRATCHED THE 8`,
      sub: call.reason === 'early-eight' ? '8-ball went down early' : '8-ball foul',
      tone: 'big',
    };
    default: return null;
  }
}

function defaultAim(s: PoolState, cue: V): number {
  const legal = legalTargets(s);
  let best = 0, bd = Infinity;
  for (const b of legal) {
    const p = s.table.pos[b];
    const d = Math.hypot(p[0] - cue[0], p[1] - cue[1]);
    if (d < bd) { bd = d; best = Math.atan2(p[0] - cue[0], p[1] - cue[1]); }
  }
  return best;
}

// ── HUD pieces ─────────────────────────────────────────────────────────────

function PlayerChip({ name, active, group, state, right }: {
  name: string; active: boolean; group: 'solid' | 'stripe' | null; state: PoolState; right?: boolean;
}) {
  const balls = group ? (group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]) : [];
  return (
    <div
      className={`flex-1 min-w-0 rounded-xl px-2.5 py-1 ${right ? 'text-right' : ''}`}
      style={{
        background: active ? 'rgba(63,242,255,0.12)' : 'rgba(12,6,24,0.6)',
        border: `1px solid ${active ? 'rgba(63,242,255,0.6)' : 'rgba(180,140,255,0.18)'}`,
        boxShadow: active ? '0 0 14px rgba(63,242,255,0.35)' : undefined,
      }}
    >
      <div className="font-display text-[12px] truncate" style={{ color: active ? '#eaffff' : 'rgba(220,210,255,0.6)' }}>{name}</div>
      <div className={`flex gap-[3px] mt-0.5 h-3 items-center ${right ? 'justify-end' : ''}`}>
        {group ? balls.map((b) => {
          const on = state.table.active[b];
          return (
            <span key={b} className="inline-block rounded-full" style={{
              width: 10, height: 10,
              background: on ? (b >= 9 ? `linear-gradient(#f7f3ea 25%, ${ballHue(b)} 25% 75%, #f7f3ea 75%)` : ballHue(b)) : 'transparent',
              border: on ? 'none' : '1px solid rgba(200,180,255,0.25)',
            }} />
          );
        }) : <span className="text-[9px] tracking-[0.2em]" style={{ color: 'rgba(200,180,255,0.45)' }}>OPEN TABLE</span>}
        {group && balls.every((b) => !state.table.active[b]) && (
          <span className="inline-block rounded-full ml-1" style={{ width: 11, height: 11, background: '#101014', border: '1px solid #ffb424', boxShadow: '0 0 6px #ffb424' }} />
        )}
      </div>
    </div>
  );
}

function MiniBall({ n, size = 18 }: { n: number; size?: number }) {
  const col = ballHue(n);
  const stripe = n >= 9;
  return (
    <span className="relative inline-flex items-center justify-center rounded-full shrink-0" style={{
      width: size, height: size,
      background: stripe ? `linear-gradient(#f7f3ea 22%, ${col} 22% 78%, #f7f3ea 78%)` : col,
      boxShadow: 'inset -2px -3px 4px rgba(0,0,0,0.35), 0 0 4px rgba(0,0,0,0.6)',
    }}>
      <span className="flex items-center justify-center rounded-full font-bold" style={{
        width: size * 0.56, height: size * 0.56, background: '#f7f3ea', color: '#111', fontSize: size * 0.36, lineHeight: 1,
      }}>{n}</span>
    </span>
  );
}

/** Ball return in the left gutter, off the table: pocketed balls stack top-down in the order they dropped. */
function PottedTray({ balls }: { balls: number[] }) {
  return (
    <div className="absolute left-0 flex flex-col items-center gap-[3px] pointer-events-none" style={{
      top: TOP_INSET + 14, bottom: BOTTOM_INSET + 14, width: TRAY_W, paddingTop: 4,
    }}>
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[18px] rounded-full" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'inset 0 0 6px rgba(0,0,0,0.8)' }} />
      {balls.map((b, i) => <span key={`${b}-${i}`} className="relative"><MiniBall n={b} size={16} /></span>)}
    </div>
  );
}

// ── Game ───────────────────────────────────────────────────────────────────

export interface PoolSeat { id: string; name: string; isNpc: boolean }

export interface PoolGameProps {
  players: PoolSeat[];         // seat 0 / seat 1
  meId: string;
  hostId: string;              // plays the NPC's turns
  initial: PoolState;
  initialSeq?: number;
  /** Online play. Absent = local game vs the bot (the lab). */
  net?: MatchNet<PoolMatch>;
  /** Server truth, when it changes out of band (resync after a failed submit). */
  sync?: { seq: number; state: PoolState; force?: boolean };
  /** Shot-clock deadline for the current turn (local ms), online only. */
  deadline?: number | null;
  onLeave?: () => void;
}

/** Solo lab: you vs a random NPC regular, no network. */
export function PoolLab() {
  const [botName] = useState(() => NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]);
  const [initial] = useState(() => newGame(Math.floor(Math.random() * 1e9), 0));
  return (
    <PoolGame
      players={[{ id: 'me', name: 'You', isNpc: false }, { id: 'bot', name: botName, isNpc: true }]}
      meId="me" hostId="me" initial={initial}
    />
  );
}

export function PoolGame({ players, meId, hostId, initial, initialSeq = 0, net, sync, deadline, onLeave }: PoolGameProps) {
  const ME = Math.max(0, players.findIndex((p) => p.id === meId));
  const names = players.map((p, i) => (i === ME ? 'You' : p.name));
  const [game, setGame] = useState<PoolState>(initial);
  const seqRef = useRef(initialSeq);
  const [playback, setPlayback] = useState<PoolPlayback | null>(null);
  const [callout, setCallout] = useState<Callout>(null);
  const [spin, setSpin] = useState<Spin>({ x: 0, y: 0 });
  const [picker, setPicker] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [gpuLost, setGpuLost] = useState(false);
  const onContextLost = useCallback(() => setGpuLost(true), []);
  // Power UI is painted straight into the DOM — no React render per touch move.
  const powerFill = useRef<HTMLDivElement>(null);
  const powerKnob = useRef<HTMLDivElement>(null);
  const powerText = useRef<HTMLSpanElement>(null);
  const paintPower = useCallback((pw: number) => {
    if (powerFill.current) powerFill.current.style.width = `${pw * 100}%`;
    if (powerKnob.current) {
      powerKnob.current.style.left = `calc(6px + (100% - 52px) * ${pw})`;
      powerKnob.current.style.background = pw > 0 ? '#ffb424' : '#eaffff';
    }
    if (powerText.current) powerText.current.textContent = pw > 0 ? `POWER ${Math.round(pw * 100)}` : 'SLIDE TO SHOOT ▶';
  }, []);
  const gameRef = useRef(game);
  useLayoutEffect(() => { gameRef.current = game; }, [game]);
  const pending = useRef<{ next: PoolState; shooter: number; newly: number[]; wasBreak: boolean } | null>(null);
  const [potted, setPotted] = useState<number[]>([]);
  const apiRef = useRef<ScreenApi | null>(null);
  const aim = useRef<AimState>({ angle: 0, pull: 0, show: true, cue: null, placing: true, legal: [], striking: 0, spin: { x: 0, y: 0 } });
  const surface = useRef<HTMLDivElement>(null);
  const spinRef = useRef<Spin>({ x: 0, y: 0 });
  useLayoutEffect(() => { spinRef.current = spin; if (gameRef.current.turn === ME) aim.current.spin = spin; }, [spin, ME]);

  const myTurn = !playback && !remoteBusy && game.winner === null && game.turn === ME && !botBusy;
  const actor = players[game.turn];
  const iDriveBot = actor?.isNpc && meId === hostId;

  // Reset the aim rig whenever a new turn begins
  useEffect(() => {
    if (playback || game.winner !== null) return;
    const a = aim.current;
    a.legal = legalTargets(game);
    a.placing = game.ballInHand && game.turn === ME;
    a.cue = game.ballInHand ? (game.isBreak ? [0, HEAD_SPOT[1]] : (game.table.pos[0] as V)) : null;
    a.angle = game.isBreak ? 0 : defaultAim(game, a.cue ?? (game.table.pos[0] as V));
    a.pull = 0;
    a.show = game.turn === ME;
    a.spin = game.turn === ME ? spinRef.current : { x: 0, y: 0 };
  }, [game, playback, ME]);

  const tableWithCue = useCallback((s: PoolState): PoolTable => {
    const a = aim.current;
    if (!a.cue) return s.table;
    return { pos: s.table.pos.map((p, i) => (i === 0 ? a.cue! : p)) as V[], active: s.table.active };
  }, []);

  const shoot = useCallback((shot: PoolShot, shooter: number) => {
    const s = gameRef.current;
    const from = tableWithCue(s);
    const sim = simulatePoolShot(from, shot);
    const next = applyShot({ ...s, table: from }, sim);
    // object balls that stayed down (an 8 re-spotted after the break doesn't count)
    const newly = [...Array(15)].map((_, i) => i + 1)
      .filter((b) => sim.pocketedAt[b] >= 0 && !next.table.active[b])
      .sort((a, b) => sim.pocketedAt[a] - sim.pocketedAt[b]);
    pending.current = { next, shooter, newly, wasBreak: s.isBreak };
    if (net) {
      const payload: PoolShotPayload = {
        cue: s.ballInHand ? (from.pos[0] as V) : null,
        shot,
        firstHit: sim.firstHit,
        railAfterContact: sim.railAfterContact,
        final: sim.final,
        rec: { numFrames: sim.numFrames, frames: f32ToB64(sim.frames), pocketedAt: sim.pocketedAt, pocketOf: sim.pocketOf, events: sim.events },
      };
      void net.submit(seqRef.current, payload);
    }
    seqRef.current += 1;
    const a = aim.current;
    a.show = false; a.placing = false; a.pull = 0; a.striking = 0.12;
    paintPower(0);
    setCallout(null);
    setPlayback({ sim, from });
    poolSfx.cue(shot.speed / 8);
    try { navigator.vibrate?.(shot.speed > 6 ? 30 : 12); } catch {}
  }, [tableWithCue, paintPower, net]);

  const onEnd = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    setTimeout(() => {
      pending.current = null;
      aim.current.cue = null;
      let c = describe(p.next.lastCall, p.shooter, names, p.next.groups, ME);
      if (p.newly.length) {
        setPotted((prev) => [...prev, ...p.newly]);
      }
      // A productive break on an open table: spell out what went down so the
      // shooter can pick a group.
      if (p.wasBreak && p.newly.length && !p.next.groups && p.next.lastCall?.kind === 'pot') {
        const solids = p.newly.filter((b) => b >= 1 && b <= 7).length;
        const stripes = p.newly.filter((b) => b >= 9).length;
        const parts = [solids && `${solids} solid${solids > 1 ? 's' : ''}`, stripes && `${stripes} stripe${stripes > 1 ? 's' : ''}`].filter(Boolean);
        c = { text: `${p.newly.length} DOWN ON THE BREAK`, sub: `${parts.join(' · ')} — table's open, pick either`, tone: 'info' };
      }
      setCallout(c);
      setGame(p.next);
      setPlayback(null);
      setRemoteBusy(false);
      queueMicrotask(() => pumpRef.current());
      if (c && c.tone !== 'big') {
        const shown = c;
        setTimeout(() => setCallout((cur) => (cur === shown ? null : cur)), shown.tone === 'info' && p.wasBreak ? 2600 : 1600);
      }
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ME]);

  // ── Online: other players' shots arrive as events; play them in order ──
  const queue = useRef<MatchEvent<PoolMatch>[]>([]);
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
        // e.g. the other player walked away, or ran out the shot clock
        setGame(e.match.state);
        seqRef.current = e.match.seq;
        if (e.match.over && e.match.state.winner === ME) {
          setCallout({ text: 'YOU WIN!', sub: e.reason === 'timeout' ? 'Your opponent timed out' : 'Your opponent left the table', tone: 'big' });
        } else if (e.reason === 'timeout' && !e.match.over) {
          const c = describe(e.match.state.lastCall, e.match.state.turn === 0 ? 1 : 0, names, e.match.state.groups, ME);
          setCallout(c);
          setTimeout(() => setCallout((cur) => (cur === c ? null : cur)), 2200);
        }
      } else if (e.seq < seqRef.current) {
        // my own shot (or the bot's, which I drove) — already played locally
      } else if (e.seq > seqRef.current) {
        setGame(e.match.state); // missed something: jump to the truth
        seqRef.current = e.match.seq;
      } else {
        setRemoteBusy(true);
        const rec = await net.fetchRec<PoolRecording>(e.seq);
        const s = gameRef.current;
        const next = e.match.state;
        seqRef.current = e.seq + 1;
        if (!rec) { setGame(next); setRemoteBusy(false); }
        else {
          const sim: PoolSimResult = {
            numFrames: rec.numFrames, frames: b64ToF32(rec.frames), pocketedAt: rec.pocketedAt, pocketOf: rec.pocketOf,
            events: rec.events, firstHit: -1, railAfterContact: false, final: next.table,
          };
          const newly = [...Array(15)].map((_, i) => i + 1)
            .filter((b) => rec.pocketedAt[b] >= 0 && !next.table.active[b])
            .sort((a, b) => rec.pocketedAt[a] - rec.pocketedAt[b]);
          const shooter = Math.max(0, players.findIndex((q) => q.id === e.actorId));
          pending.current = { next, shooter, newly, wasBreak: s.isBreak };
          aim.current.show = false; aim.current.placing = false; aim.current.cue = null;
          setCallout(null);
          setPlayback({ sim, from: s.table });
          // The recording doesn't carry cue power; the first contact's speed is a good proxy
          const first = sim.events.find((ev) => ev.type === 'ball');
          poolSfx.cue(first && 'speed' in first ? first.speed / 3 : 0.5);
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

  // Resync from the server when the room hands us newer truth
  // Server truth from a reload, applied once any playback has finished. `force`
  // means the server refused our shot (e.g. the clock ran out first), so it
  // replaces our optimistic state even at the same seq.
  const appliedSync = useRef(sync);
  useEffect(() => {
    if (!sync || sync === appliedSync.current || pending.current || playback) return;
    appliedSync.current = sync;
    if (sync.seq === seqRef.current && !sync.force) return;
    seqRef.current = sync.seq;
    setGame(sync.state);
  }, [sync, playback]);

  // ── Bot turn: think, swing the cue into line, pull back, fire ──
  useEffect(() => {
    if (playback || game.winner !== null || !iDriveBot) return;
    setBotBusy(true);
    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => { if (!cancelled) fn(); }, ms));
    later(900, () => {
      const plan = planBotShot(game, BOT_SKILL, game.shotCount * 7919 + 13);
      const a = aim.current;
      if (plan.cue) a.cue = plan.cue;
      a.show = true; a.placing = false;
      a.spin = { x: plan.shot.side ?? 0, y: plan.shot.spin };
      const from = a.angle;
      let to = plan.shot.angle;
      while (to - from > Math.PI) to -= 2 * Math.PI;
      while (to - from < -Math.PI) to += 2 * Math.PI;
      const t0 = performance.now();
      const swing = () => {
        if (cancelled) return;
        const k = Math.min(1, (performance.now() - t0) / 800);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        a.angle = from + (to - from) * e;
        const pullK = Math.max(0, (performance.now() - t0 - 900) / 450);
        a.pull = Math.min(1, pullK) * Math.min(1, plan.shot.speed / MAX_SPEED + 0.15);
        if (pullK < 1.15) requestAnimationFrame(swing);
        else { setBotBusy(false); shoot(plan.shot, game.turn); }
      };
      requestAnimationFrame(swing);
    });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [game, playback, shoot, iDriveBot]);

  // ── Touch input: table (aim / place cue), power bar, fine-aim roller ──
  const speedRef = useRef(1);
  const playingRef = useRef(false);
  useLayoutEffect(() => { playingRef.current = !!playback; if (!playback) speedRef.current = 1; }, [playback]);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    type Mode = 'aim' | 'place' | null;
    let mode: Mode = null, sx = 0, sy = 0, moved = false, lastTheta = 0;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const cuePos = () => aim.current.cue ?? (gameRef.current.table.pos[0] as V);

    const down = (e: PointerEvent) => {
      if (!myTurnRef.current) {
        if (playingRef.current) speedRef.current = 3.5; // tap to fast-forward the roll
        return;
      }
      const p = apiRef.current?.toTable(e.clientX, e.clientY);
      if (!p) return;
      try { el.setPointerCapture(e.pointerId); } catch {}
      sx = e.clientX; sy = e.clientY; moved = false;
      const c = cuePos();
      if (aim.current.placing && Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.16) { mode = 'place'; return; }
      mode = 'aim';
      lastTheta = Math.atan2(p[0] - c[0], p[1] - c[1]);
    };
    const move = (e: PointerEvent) => {
      if (!mode) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) moved = true;
      const p = apiRef.current?.toTable(e.clientX, e.clientY);
      if (!p) return;
      const a = aim.current;
      if (mode === 'place') {
        const s = gameRef.current;
        const z = s.isBreak ? Math.min(p[1], HEAD_SPOT[1]) : p[1];
        if (canPlaceCue(s, p[0], z)) a.cue = [p[0], z];
        return;
      }
      if (!moved) return;
      // Grab-and-turn: the aim rotates by how far your finger swings around the
      // cue ball. Close to the ball that swing is damped, so it never whips.
      const c = cuePos();
      const theta = Math.atan2(p[0] - c[0], p[1] - c[1]);
      const dist = Math.hypot(p[0] - c[0], p[1] - c[1]);
      a.angle += wrap(theta - lastTheta) * Math.min(1, dist / 0.18);
      lastTheta = theta;
    };
    const up = (e: PointerEvent) => {
      if (mode === 'aim' && !moved) {
        // a tap points the cue straight at that spot
        const p = apiRef.current?.toTable(e.clientX, e.clientY);
        const c = cuePos();
        if (p && Math.hypot(p[0] - c[0], p[1] - c[1]) > 2 * R) aim.current.angle = Math.atan2(p[0] - c[0], p[1] - c[1]);
      }
      mode = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  // Slide to shoot: drag right to load power, let go to fire; slide back to cancel.
  const powerDrag = useRef<{ x0: number; w: number } | null>(null);
  const onPowerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    powerDrag.current = { x0: e.clientX, w: e.currentTarget.clientWidth };
  };
  const onPowerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = powerDrag.current;
    if (!d) return;
    const pw = Math.max(0, Math.min(1, (e.clientX - d.x0) / (d.w * 0.82)));
    aim.current.pull = pw;
    paintPower(pw);
  };
  const onPowerUp = () => {
    if (!powerDrag.current) return;
    powerDrag.current = null;
    const pw = aim.current.pull;
    if (pw > 0.03) {
      const sp = spinRef.current;
      shoot({ angle: aim.current.angle, speed: 0.3 + Math.pow(pw, 1.35) * (MAX_SPEED - 0.3), spin: sp.y, side: sp.x }, ME);
      setSpin({ x: 0, y: 0 }); // like most pool games: each shot starts from centre ball
    }
    else { aim.current.pull = 0; paintPower(0); }
  };

  // Fine-aim roller: horizontal drag nudges the aim ~0.07° per px.
  const roller = useRef<{ x: number } | null>(null);
  const ridges = useRef<HTMLDivElement>(null);
  const ridgeOffset = useRef(0);
  const onRollDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    roller.current = { x: e.clientX };
  };
  const onRollMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = roller.current;
    if (!r) return;
    const dx = e.clientX - r.x;
    r.x = e.clientX;
    aim.current.angle -= dx * 0.0012;
    ridgeOffset.current += dx;
    if (ridges.current) ridges.current.style.backgroundPositionX = `${ridgeOffset.current}px`;
  };
  const onRollUp = () => { roller.current = null; };

  const myTurnRef = useRef(myTurn);
  useLayoutEffect(() => { myTurnRef.current = myTurn; }, [myTurn]);

  // Dev hook: window.__pool({ angle, speed, spin })
  useEffect(() => { (window as unknown as { __pool?: unknown }).__pool = (s: PoolShot) => shoot(s, gameRef.current.turn); }, [shoot]);

  const onEvent = useCallback((e: PoolSimResult['events'][number]) => {
    if (e.type === 'ball') poolSfx.clack(e.speed);
    else if (e.type === 'rail') poolSfx.rail(e.speed);
    else if (e.type === 'pocket') {
      poolSfx.pocket(e.a === 0);
      try { navigator.vibrate?.(e.a === 0 ? [20, 40, 20] : 14); } catch {}
    }
  }, []);

  // Jingles for the big moments
  useEffect(() => {
    if (!callout) return;
    if (callout.tone === 'big') marbleSfx.finish(true);
    else if (callout.tone === 'bad') bowlSfx.miss();
  }, [callout]);

  const groups = game.groups;
  const hint = game.turn === ME && !playback && game.winner === null
    ? game.ballInHand ? (game.isBreak ? 'Drag the cue ball · slide to break' : 'Ball in hand — drag the cue ball') : 'Drag to turn · tap to point · slide to shoot'
    : '';

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: '#06040b' }}>
      <PoolScene table={game.table} playback={playback} aim={aim} onEnd={onEnd} onEvent={onEvent} apiRef={apiRef}
        insets={INSETS} speedRef={speedRef} onContextLost={onContextLost} />
      {gpuLost && (
        <button
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3"
          style={{ background: 'rgba(6,4,11,0.92)' }}
          onClick={() => window.location.reload()}
        >
          <span className="font-display text-2xl" style={{ color: '#fff3d6', textShadow: '0 0 12px #ffb424' }}>The table glitched</span>
          <span className="text-[12px] tracking-[0.25em] uppercase" style={{ color: 'rgba(210,195,255,0.8)' }}>Tap to reload</span>
        </button>
      )}
      <div ref={surface} className="absolute inset-0" style={{ touchAction: 'none' }} />

      <PottedTray balls={potted} />
      <SoundToggle className="absolute right-2 z-20" style={{ top: 'calc(max(8px, env(safe-area-inset-top)) + 60px)' }} />

      {/* Players */}
      <div className="absolute top-0 inset-x-0 px-2 flex gap-2 pointer-events-none" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}>
        <PlayerChip name={names[0]} active={game.turn === 0 && game.winner === null} group={groups?.[0] ?? null} state={game} />
        <PlayerChip name={names[1]} active={game.turn === 1 && game.winner === null} group={groups?.[1] ?? null} state={game} right />
      </div>

      {/* Bottom controls: hint · spin + fine aim · slide-to-shoot */}
      <div
        className="absolute inset-x-0 bottom-0 px-3 flex flex-col gap-2"
        style={{ height: BOTTOM_INSET, paddingBottom: 'max(12px, env(safe-area-inset-bottom))', justifyContent: 'flex-end' }}
      >
        <div className="flex justify-center">
          <ShotClock
            deadline={deadline}
            maxMs={SHOT_CLOCK_MS.pool}
            mine={game.turn === ME}
            who={names[game.turn]}
            visible={!!net && !playback && !remoteBusy && game.winner === null && !actor?.isNpc}
          />
        </div>
        <p className="text-center text-[11px] tracking-[0.16em] uppercase pointer-events-none" style={{ color: game.turn !== ME && !playback ? 'rgba(255,154,232,0.85)' : 'rgba(210,195,255,0.75)' }}>
          {playback ? 'Tap to speed up' : game.turn !== ME && game.winner === null ? `${names[game.turn]} is lining up…` : hint}
        </p>
        <div className="flex items-center gap-3" style={{ opacity: myTurn ? 1 : 0.25, pointerEvents: myTurn ? 'auto' : 'none' }}>
          <SpinBadge spin={spin} onClick={() => setPicker(true)} />
          <div
            className="relative flex-1 h-10 rounded-xl overflow-hidden"
            style={{ background: 'rgba(10,6,20,0.8)', border: '1px solid rgba(63,242,255,0.3)', touchAction: 'none' }}
            onPointerDown={onRollDown} onPointerMove={onRollMove} onPointerUp={onRollUp} onPointerCancel={onRollUp}
          >
            <div ref={ridges} className="absolute inset-0" style={{
              background: 'repeating-linear-gradient(90deg, rgba(200,180,255,0) 0 6px, rgba(200,180,255,0.35) 6px 8px)',
              maskImage: 'linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)',
              WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)',
            }} />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] font-bold tracking-[0.25em] px-2 rounded" style={{ color: '#9bf6ff', background: 'rgba(10,6,20,0.8)' }}>◀ FINE AIM ▶</span>
            </div>
          </div>
        </div>

        {/* Slide to shoot: drag right to load power, let go to fire, slide back to cancel */}
        <div
          className="relative h-[52px] rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(10,6,20,0.85)', border: '1px solid rgba(255,180,36,0.45)', boxShadow: '0 0 16px rgba(255,180,36,0.15)',
            touchAction: 'none', opacity: myTurn ? 1 : 0.25, pointerEvents: myTurn ? 'auto' : 'none',
          }}
          onPointerDown={onPowerDown} onPointerMove={onPowerMove} onPointerUp={onPowerUp} onPointerCancel={onPowerUp}
        >
          <div ref={powerFill} className="absolute inset-y-0 left-0" style={{
            width: 0, background: 'linear-gradient(90deg, #3ff2ff, #ffb424 60%, #ff3fd0)', boxShadow: '0 0 18px rgba(255,63,208,0.6)',
          }} />
          {[0.25, 0.5, 0.75].map((t) => (
            <div key={t} className="absolute inset-y-2" style={{ left: `${t * 100}%`, width: 1, background: 'rgba(255,255,255,0.15)' }} />
          ))}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span ref={powerText} className="font-display text-[13px] tracking-[0.2em]" style={{ color: '#fff3d6', textShadow: '0 0 8px rgba(0,0,0,0.9)' }}>
              SLIDE TO SHOOT ▶
            </span>
          </div>
          <div ref={powerKnob} className="absolute top-1.5 bottom-1.5 rounded-xl pointer-events-none" style={{
            left: 6, width: 40, background: '#eaffff', boxShadow: '0 0 12px rgba(63,242,255,0.8)',
          }} />
        </div>
      </div>

      {picker && <SpinPicker value={spin} onChange={setSpin} onClose={() => setPicker(false)} />}

      {callout && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span key={callout.text} className={`pool-callout pool-${callout.tone} font-display`}>{callout.text}</span>
          {callout.sub && <span className="mt-2 text-[12px] tracking-[0.2em] uppercase" style={{ color: 'rgba(230,220,255,0.85)' }}>{callout.sub}</span>}
        </div>
      )}

      {game.winner !== null && !playback && (
        <div className="absolute inset-x-0 flex flex-col items-center gap-3" style={{ bottom: '18%' }}>
          {/* Only wins over another person make the board */}
          <TonightRank game="pool" name={players[ME]?.name} enabled={!!net && game.winner === ME && players.every((p) => !p.isNpc)} />
          {!net ? (
            <button
              className="btn-amber rounded-2xl px-8 py-4 font-bold uppercase tracking-wide active:scale-95 transition-transform"
              onClick={() => { setCallout(null); setPotted([]); setGame(newGame(Math.floor(Math.random() * 1e9), game.winner === 0 ? 1 : 0)); }}
            >
              Rack &rsquo;em
            </button>
          ) : meId === hostId ? (
            <button
              className="btn-amber rounded-2xl px-8 py-4 font-bold uppercase tracking-wide active:scale-95 transition-transform"
              onClick={() => { void net.rematch(); }}
            >
              Rack &rsquo;em again
            </button>
          ) : (
            <p className="text-[12px] tracking-[0.2em] uppercase" style={{ color: 'rgba(210,195,255,0.8)' }}>
              Waiting for {players.find((q) => q.id === hostId)?.name ?? 'the host'} to rack…
            </p>
          )}
          {onLeave && (
            <button className="text-[12px] tracking-[0.2em] uppercase underline underline-offset-4" style={{ color: 'rgba(210,195,255,0.7)' }} onClick={onLeave}>
              Leave table
            </button>
          )}
        </div>
      )}

      <style>{`
        .pool-callout { font-size: 46px; animation: poolIn .7s cubic-bezier(.2,1.4,.3,1) both; text-align: center; padding: 0 16px; }
        .pool-good { color: #eaffff; text-shadow: 0 0 8px #fff, 0 0 22px #3ff2ff, 0 0 44px #3ff2ff; }
        .pool-bad { color: #ffe3ea; text-shadow: 0 0 8px #fff, 0 0 22px #ff2a55, 0 0 44px #ff2a55; }
        .pool-info { color: #fff3d6; font-size: 34px; text-shadow: 0 0 10px #ffb424, 0 0 30px #ffb424; }
        .pool-big { color: #fff0fb; font-size: 58px; text-shadow: 0 0 6px #fff, 0 0 20px #ff3fd0, 0 0 50px #b44bff; }
        @keyframes poolIn { 0% { transform: scale(2); opacity: 0; filter: blur(6px) } 25% { opacity: 1; filter: blur(0) } 100% { transform: scale(1); opacity: 1 } }
      `}</style>
    </div>
  );
}

