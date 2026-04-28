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
