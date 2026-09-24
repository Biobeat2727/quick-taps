'use client';

import { MARBLE_COLORS, NPC_NAMES } from '@/lib/constants';
import type { SessionPlayer } from '@/types/session';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_PARTICIPANTS = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Participant {
  id: string;
  name: string;
  color: string;
}

export type Phase = 'countdown' | 'racing' | 'finished';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function buildParticipants(players: SessionPlayer[]): Participant[] {
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

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ── Shared UI components ───────────────────────────────────────────────────────

export function CountdownOverlay({ val }: { val: number | null }) {
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
          fontFamily: 'var(--font-bungee), system-ui, sans-serif',
          color: isGo ? '#FFB424' : '#FFF3D6',
          textShadow: `0 0 18px ${isGo ? '#FFB424CC' : '#FFFFFF66'}, 0 0 60px ${isGo ? '#FF960088' : '#FFFFFF44'}`,
          animation: 'cntPop 0.95s ease-out forwards',
        }}
      >
        {text}
      </span>
      <style>{`@keyframes cntPop{0%{transform:scale(1.6);opacity:1}65%{transform:scale(1.05);opacity:1}100%{transform:scale(0.85);opacity:0}}`}</style>
    </div>
  );
}

export function ResultsScreen({
  ranking, myPlayerId, onLeave, onRaceAgain,
}: {
  ranking: Participant[];
  myPlayerId: string;
  onLeave: () => void;
  onRaceAgain: () => void;
}) {
  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const winner = top3[0];

  const podiumSlots = [
    { p: top3[1], label: '2nd', podH: 80, podColor: '#A0A0A8', delay: 0.15 },
    { p: top3[0], label: '1st', podH: 120, podColor: '#F0C040', delay: 0.45 },
    { p: top3[2], label: '3rd', podH: 56, podColor: '#C87941', delay: 0 },
  ];

  return (
    <main
      style={{
        minHeight: '100dvh', background: 'var(--qt-night, #0C0A14)', color: 'var(--qt-cream, #F5EDDF)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 16px 48px', fontFamily: 'var(--font-rubik), system-ui, sans-serif',
      }}
    >
      <h1
        className="neon-sign"
        style={{ fontSize: 32, margin: '0 0 8px', fontWeight: 400 }}
      >
        Race Over
      </h1>
      {winner && (
        <p style={{ margin: '0 0 28px', fontSize: 14, color: 'var(--qt-mute, #8E86A0)' }}>
          <span style={{ color: winner.color, fontWeight: 700 }}>{winner.name}</span>
          {winner.id === myPlayerId ? ' — that’s you. Drinks on them.' : ' takes it.'}
        </p>
      )}

      {top3.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 36 }}>
          {podiumSlots.map(({ p, label, podH, podColor, delay }, slotIdx) => {
            if (!p) return <div key={slotIdx} style={{ width: 104 }} />;
            const isMe = p.id === myPlayerId;
            const isFirst = label === '1st';
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'flex-end', width: 104,
                  animation: `podRise 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) ${delay}s both`,
                }}
              >
                <span
                  style={{
                    width: 44, height: 44, borderRadius: '50%', background: p.color,
                    display: 'block', marginBottom: 6, flexShrink: 0,
                    boxShadow: isFirst
                      ? `0 0 18px ${p.color}, 0 0 40px ${p.color}88${isMe ? ', 0 0 0 3px #fff' : ''}`
                      : isMe
                        ? `0 0 0 3px #fff, 0 0 12px ${p.color}88`
                        : `0 0 10px ${p.color}55`,
                  }}
                />
                <span
                  style={{
                    fontSize: 13, fontWeight: 600, marginBottom: 8, textAlign: 'center',
                    color: isMe ? 'var(--qt-amber, #FFB424)' : 'var(--qt-cream, #F5EDDF)',
                    wordBreak: 'break-word', maxWidth: 96,
                  }}
                >
                  {p.name}
                </span>
                <div
                  style={{
                    width: 88, height: podH, background: podColor,
                    borderRadius: '6px 6px 0 0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isFirst ? '0 0 24px rgba(240, 192, 64, 0.35)' : 'none',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-bungee), sans-serif',
                      fontSize: 16, color: '#1A1206',
                    }}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
          <style>{`
            @keyframes podRise {
              from { transform: translateY(40px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              [style*="podRise"] { animation: none !important; }
            }
          `}</style>
        </div>
      )}

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
                  background: isMe ? 'rgba(255,180,36,0.1)' : 'var(--qt-panel, #171225)',
                  border: isMe
                    ? '1px solid rgba(255,180,36,0.4)'
                    : '1px solid var(--qt-line, #2A2338)',
                }}
              >
                <span style={{ color: 'var(--qt-mute, #8E86A0)', width: 32, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>
                  {ordinal(i + 4)}
                </span>
                <span
                  style={{
                    width: 20, height: 20, borderRadius: '50%', background: p.color,
                    flexShrink: 0, boxShadow: `0 0 8px ${p.color}66`,
                  }}
                />
                <span style={{ fontSize: 15, fontWeight: isMe ? 700 : 400 }}>{p.name}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
        <button
          onClick={onRaceAgain}
          style={{
            flex: 1, padding: '15px 0', borderRadius: 16,
            background: 'var(--qt-amber, #FFB424)', color: '#1A1206',
            fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            boxShadow: '0 0 22px rgba(255, 180, 36, 0.25)',
          }}
        >
          Race Again
        </button>
        <button
          onClick={onLeave}
          style={{
            flex: 1, padding: '15px 0', borderRadius: 16,
            background: 'var(--qt-panel-2, #1F1930)', color: 'var(--qt-cream, #F5EDDF)',
            fontWeight: 700, fontSize: 15,
            border: '1px solid var(--qt-line, #2A2338)', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}
        >
          Leave
        </button>
      </div>
    </main>
  );
}
