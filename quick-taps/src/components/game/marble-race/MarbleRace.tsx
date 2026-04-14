'use client';

import { useEffect, useRef, useState } from 'react';
import Track from './Track';
import { useMarblePhysics, type MarbleState } from './useMarblePhysics';
import type { SessionPlayer } from '@/types/session';
import { MARBLE_COLORS, NPC_NAMES } from '@/lib/constants';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRACK_W = 390;
const TRACK_H = 2800;
const VIEWPORT_H = 844;
const PLAYER_Y_FRAC = 0.4;
const CAM_LERP = 0.08;
const MARBLE_R = 8;
const MAX_PARTICIPANTS = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  name: string;
  color: string;
}

type Phase = 'countdown' | 'racing' | 'finished';

interface Props {
  players: SessionPlayer[];
  myPlayerId: string;
  isProjector?: boolean;
  onLeave: () => void;
  onRaceAgain: () => void;
  onRaceFinished?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildParticipants(players: SessionPlayer[]): Participant[] {
  const list: Participant[] = players.map(p => ({ id: p.id, name: p.name, color: p.color }));
  const taken = new Set(players.map(p => p.color));
  const free = MARBLE_COLORS.filter(c => !taken.has(c.hex));
  let fi = 0;
  for (let i = 0; list.length < MAX_PARTICIPANTS; i++) {
    list.push({
      id: `npc-${i}`,
      name: NPC_NAMES[i % NPC_NAMES.length],
      color: free[fi++]?.hex ?? '#888888',
    });
  }
  return list;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function marbleProgress(m: MarbleState): number {
  if (m.finished) return 9999 + (m.placement ?? 0);
  if (m.act === 1) return m.y;
  if (m.act === 2) return 800 + m.laneT * 1200;
  // act 3: closer to center = more progress
  return 2000 + (1 - m.radius / 140) * 400;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CountdownOverlay({ val }: { val: number | null }) {
  const text = val === null ? 'GO!' : String(val);
  const isGo = val === null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      }}
    >
      <span
        key={text}
        style={{
          fontSize: isGo ? 80 : 104,
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          color: isGo ? '#EF9F27' : '#FFFFFF',
          textShadow: `0 0 50px ${isGo ? '#EF9F2788' : '#FFFFFF88'}`,
          animation: 'cntPop 0.95s ease-out forwards',
          letterSpacing: isGo ? '-2px' : '0',
        }}
      >
        {text}
      </span>
      <style>{`@keyframes cntPop{0%{transform:scale(1.6);opacity:1}65%{transform:scale(1.05);opacity:1}100%{transform:scale(0.85);opacity:0}}`}</style>
    </div>
  );
}

function ResultsScreen({
  ranking, myPlayerId, onLeave, onRaceAgain,
}: {
  ranking: Participant[];
  myPlayerId: string;
  onLeave: () => void;
  onRaceAgain: () => void;
}) {
  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  // Podium order: 2nd (left), 1st (center, tallest), 3rd (right)
  const podiumSlots = [
    { p: top3[1], label: '2nd', podH: 80, podColor: '#A0A0A8' },
    { p: top3[0], label: '1st', podH: 120, podColor: '#F0C040' },
    { p: top3[2], label: '3rd', podH: 56, podColor: '#C87941' },
  ];

  return (
    <main
      style={{
        minHeight: '100dvh', background: '#1C1B16', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 16px 48px', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 900, color: '#EF9F27', margin: '0 0 32px' }}>
        Race Over!
      </h1>

      {/* Podium */}
      {top3.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 36 }}>
          {podiumSlots.map(({ p, label, podH, podColor }, slotIdx) => {
            if (!p) return <div key={slotIdx} style={{ width: 104 }} />;
            const isMe = p.id === myPlayerId;
            return (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 104 }}>
                <span
                  style={{
                    width: 44, height: 44, borderRadius: '50%', background: p.color,
                    display: 'block', marginBottom: 6, flexShrink: 0,
                    boxShadow: isMe ? `0 0 0 3px #fff, 0 0 0 5px ${p.color}66` : 'none',
                  }}
                />
                <span
                  style={{
                    fontSize: 13, fontWeight: 600, marginBottom: 8, textAlign: 'center',
                    color: isMe ? '#EF9F27' : '#fff', wordBreak: 'break-word', maxWidth: 96,
                  }}
                >
                  {p.name}
                </span>
                <div
                  style={{
                    width: 88, height: podH, background: podColor,
                    borderRadius: '6px 6px 0 0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span style={{ fontWeight: 900, fontSize: 18, color: '#1C1B16' }}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4th place and below */}
      {rest.length > 0 && (
        <div style={{ width: '100%', maxWidth: 360, marginBottom: 36 }}>
          {rest.map((p, i) => {
            const isMe = p.id === myPlayerId;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px', borderRadius: 12, marginBottom: 8,
                  background: isMe ? 'rgba(239,159,39,0.12)' : 'rgba(255,255,255,0.05)',
                  border: isMe ? '1px solid rgba(239,159,39,0.35)' : '1px solid transparent',
                }}
              >
                <span style={{ color: '#666', width: 32, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>
                  {ordinal(i + 4)}
                </span>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: isMe ? 700 : 400 }}>{p.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
        <button
          onClick={onRaceAgain}
          style={{
            flex: 1, padding: '15px 0', borderRadius: 16,
            background: '#EF9F27', color: '#1C1B16',
            fontWeight: 700, fontSize: 16, border: 'none', cursor: 'pointer',
          }}
        >
          Race Again
        </button>
        <button
          onClick={onLeave}
          style={{
            flex: 1, padding: '15px 0', borderRadius: 16,
            background: 'rgba(255,255,255,0.08)', color: '#fff',
            fontWeight: 700, fontSize: 16, border: 'none', cursor: 'pointer',
          }}
        >
          Leave
        </button>
      </div>
    </main>
  );
}

// ── Projector leaderboard ─────────────────────────────────────────────────────

function ProjectorLeaderboardShell({
  participants,
  domRef,
}: {
  participants: Participant[];
  domRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Initial render with participant names; rAF loop updates via innerHTML
  return (
    <div
      style={{
        flex: 1, padding: '24px 20px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <h2
        style={{
          fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: 700,
          color: '#EF9F27', margin: '0 0 16px', letterSpacing: '-0.3px',
        }}
      >
        Leaderboard
      </h2>
      <div ref={domRef}>
        {participants.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', marginBottom: 6,
            }}
          >
            <span style={{ color: '#666', fontWeight: 700, width: 22, textAlign: 'right', fontSize: 14 }}>{i + 1}</span>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
            <span style={{ color: '#fff', fontSize: 15, flex: 1 }}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarbleRace({
  players, myPlayerId, isProjector = false, onLeave, onRaceAgain, onRaceFinished,
}: Props) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countVal, setCountVal] = useState<number | null>(3);
  const [finalRanking, setFinalRanking] = useState<Participant[]>([]);
  const [projScale, setProjScale] = useState(0.35);

  const participantsRef = useRef<Participant[]>(buildParticipants(players));
  const marbleCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const leaderboardDomRef = useRef<HTMLDivElement>(null);
  const cameraYRef = useRef(0);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);

  const { marbles, placements, initMarbles, step } = useMarblePhysics();

  // Compute projector scale after mount
  useEffect(() => {
    if (isProjector) {
      const scale = Math.min(
        window.innerHeight / TRACK_H,
        (window.innerWidth * 0.4) / TRACK_W,
      );
      setProjScale(scale);
    }
  }, [isProjector]);

  // Init marbles once
  useEffect(() => {
    initMarbles(participantsRef.current.map(p => p.id));
  }, [initMarbles]);

  // Countdown: 3 → 2 → 1 → GO! → racing
  useEffect(() => {
    const timers = [
      setTimeout(() => setCountVal(2), 1000),
      setTimeout(() => setCountVal(1), 2000),
      setTimeout(() => setCountVal(null), 3000),   // GO!
      setTimeout(() => setPhase('racing'), 3800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Physics + draw loop
  useEffect(() => {
    if (phase !== 'racing') return;

    const canvas = marbleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const participants = participantsRef.current;
    const pMap = new Map(participants.map(p => [p.id, p]));
    const total = participants.length;
    let done = false;

    const loop = () => {
      if (done) return;
      frameRef.current++;
      step();

      const ms = marbles.current;

      // Finish check
      if (placements.current.length >= total) {
        done = true;
        ctx.clearRect(0, 0, TRACK_W, TRACK_H);
        const ranked = placements.current
          .map(id => pMap.get(id))
          .filter((p): p is Participant => p !== undefined);
        setFinalRanking(ranked);
        setPhase('finished');
        onRaceFinished?.();
        return;
      }

      const myMarble = ms.find(m => m.id === myPlayerId);
      const frame = frameRef.current;

      // Camera lerp (phone only)
      if (!isProjector && myMarble) {
        const targetY = Math.max(
          0,
          Math.min(TRACK_H - VIEWPORT_H, myMarble.y - VIEWPORT_H * PLAYER_Y_FRAC),
        );
        cameraYRef.current += (targetY - cameraYRef.current) * CAM_LERP;
        if (scrollContainerRef.current) {
          scrollContainerRef.current.style.transform =
            `translateX(-50%) translateY(-${Math.round(cameraYRef.current)}px)`;
        }
      }

      // Real-time placement HUD (phone only)
      if (!isProjector && myMarble && hudRef.current) {
        const myProg = marbleProgress(myMarble);
        let rank = 1;
        for (const m of ms) {
          if (m.id !== myPlayerId && marbleProgress(m) > myProg) rank++;
        }
        hudRef.current.textContent = ordinal(rank);
      }

      // Draw marbles
      ctx.clearRect(0, 0, TRACK_W, TRACK_H);
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.15);

      for (const m of ms) {
        const p = pMap.get(m.id);
        if (!p) continue;
        const isMe = m.id === myPlayerId;

        // Pulsing ring on player's marble
        if (isMe) {
          ctx.beginPath();
          ctx.arc(m.x, m.y, MARBLE_R + 2 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${(0.3 + pulse * 0.5).toFixed(2)})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Marble body
        ctx.beginPath();
        ctx.arc(m.x, m.y, MARBLE_R, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Specular highlight
        ctx.beginPath();
        ctx.arc(m.x - 2.5, m.y - 2.5, MARBLE_R * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();

        // Name label (projector only)
        if (isProjector) {
          ctx.font = 'bold 9px system-ui';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fff';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 4;
          ctx.fillText(p.name.split(' ')[0], m.x, m.y - MARBLE_R - 3);
          ctx.shadowBlur = 0;
        }
      }

      // Projector leaderboard (direct DOM, every 20 frames)
      if (isProjector && leaderboardDomRef.current && frame % 20 === 0) {
        const sorted = [...ms].sort((a, b) => marbleProgress(b) - marbleProgress(a));
        leaderboardDomRef.current.innerHTML = sorted
          .map((m, i) => {
            const p = pMap.get(m.id);
            if (!p) return '';
            const done = m.finished ? ' ✓' : '';
            return (
              `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;` +
              `background:rgba(255,255,255,0.05);margin-bottom:6px">` +
              `<span style="color:#666;font-weight:700;width:22px;text-align:right;font-size:14px">${i + 1}</span>` +
              `<span style="width:14px;height:14px;border-radius:50%;background:${p.color};flex-shrink:0"></span>` +
              `<span style="color:#fff;font-size:15px;flex:1">${p.name}</span>` +
              `<span style="color:#EF9F27;font-size:12px">${done}</span>` +
              `</div>`
            );
          })
          .join('');
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, step, marbles, placements, myPlayerId, isProjector]);

  // ── Results ───────────────────────────────────────────────────────────────

  if (phase === 'finished') {
    return (
      <ResultsScreen
        ranking={finalRanking}
        myPlayerId={myPlayerId}
        onLeave={onLeave}
        onRaceAgain={onRaceAgain}
      />
    );
  }

  const showCountdown = phase === 'countdown';
  const trackDisplayW = Math.round(TRACK_W * projScale);
  const trackDisplayH = Math.round(TRACK_H * projScale);

  // ── Projector view ────────────────────────────────────────────────────────

  if (isProjector) {
    return (
      <div
        style={{
          display: 'flex', width: '100vw', height: '100vh',
          background: '#1C1B16', overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Track + marble canvas */}
        <div
          style={{
            position: 'relative',
            width: trackDisplayW,
            height: trackDisplayH,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, left: 0,
              transform: `scale(${projScale})`,
              transformOrigin: 'top left',
              width: TRACK_W,
              height: TRACK_H,
            }}
          >
            <Track />
            <canvas
              ref={marbleCanvasRef}
              width={TRACK_W}
              height={TRACK_H}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            />
          </div>
          {showCountdown && <CountdownOverlay val={countVal} />}
        </div>

        {/* Leaderboard sidebar */}
        <ProjectorLeaderboardShell
          participants={participantsRef.current}
          domRef={leaderboardDomRef}
        />
      </div>
    );
  }

  // ── Phone view ────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        overflow: 'hidden',
        position: 'relative',
        background: '#1C1B16',
      }}
    >
      {/* Scrolling track container — transform updated directly from rAF loop */}
      <div
        ref={scrollContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: TRACK_W,
          height: TRACK_H,
        }}
      >
        <Track />
        <canvas
          ref={marbleCanvasRef}
          width={TRACK_W}
          height={TRACK_H}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
      </div>

      {/* HUD — placement badge */}
      {phase === 'racing' && (
        <div
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            background: 'rgba(0,0,0,0.58)', borderRadius: 14,
            padding: '5px 14px',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div
            ref={hudRef}
            style={{
              color: '#fff', fontWeight: 800, fontSize: 22,
              fontFamily: 'system-ui, sans-serif', letterSpacing: '-0.5px',
            }}
          >
            1st
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {showCountdown && <CountdownOverlay val={countVal} />}
    </div>
  );
}
