'use client';

import { useEffect, useRef, useState } from 'react';
import Track from './Track';
import { useMarblePhysics, type MarbleState } from './useMarblePhysics';
import type { SessionPlayer } from '@/types/session';
import {
  buildParticipants, ordinal, CountdownOverlay, ResultsScreen,
  type Participant, type Phase,
} from './marble-race-shared';

// ── Constants ─────────────────────────────────────────────────────────────────

const TRACK_W = 390;
const TRACK_H = 2800;
const VIEWPORT_H = 844;
const PLAYER_Y_FRAC = 0.4;
const CAM_LERP = 0.08;
const MARBLE_R = 8;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  players: SessionPlayer[];
  myPlayerId: string;
  isProjector?: boolean;
  seed?: number;
  onLeave: () => void;
  onRaceAgain: () => void;
  onRaceFinished?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function marbleProgress(m: MarbleState): number {
  if (m.finished) return 9999 + (m.placement ?? 0);
  if (m.act === 1) return m.y;
  if (m.act === 2) return m.y;
  // act 3: closer to funnel center = more progress
  const dx = m.x - 195;
  const dy = m.y - 2200;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return 2000 + (1 - dist / 140) * 400;
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
