'use client';

// Home screen: who else has the app open right now, and a tap to challenge them.

import { useState } from 'react';
import { GAME_LABELS } from '@/lib/constants';
import type { GameId } from '@/types/session';
import { usePresence, type Person } from './PresenceProvider';

const GAMES: GameId[] = ['pool', 'bowling', 'marble_race'];

function statusText(p: Person) {
  const game = p.game ? GAME_LABELS[p.game] ?? p.game : '';
  if (p.status === 'playing') return `Playing ${game}`.trim();
  if (p.status === 'table') return game ? `At a ${game} table` : 'At a table';
  return 'Looking for a game';
}

export function AtTheBar() {
  const { people, challenge } = usePresence();
  const [picking, setPicking] = useState<Person | null>(null);
  const [sending, setSending] = useState(false);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {people.length > 0 && <span className="live-dot w-2 h-2 rounded-full" />}
        <h2 className="text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">
          At the bar now{people.length > 0 ? ` · ${people.length}` : ''}
        </h2>
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-[var(--qt-mute)] pb-1">Just you so far. Anyone who opens Quick Taps shows up here.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {people.map((p) => {
            const free = p.status !== 'playing';
            return (
              <button
                key={p.id}
                onClick={() => free && setPicking(p)}
                disabled={!free}
                className="flex-shrink-0 rounded-2xl border px-3 py-2 text-left active:scale-95 transition-transform disabled:active:scale-100"
                style={{
                  background: 'var(--qt-panel)',
                  borderColor: free ? 'var(--qt-line)' : 'transparent',
                  opacity: free ? 1 : 0.6,
                  minWidth: 120,
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: free ? 'var(--qt-ice, #45e0ff)' : 'var(--qt-mute)', boxShadow: free ? '0 0 6px var(--qt-ice, #45e0ff)' : undefined }}
                  />
                  <span className="font-bold text-[14px] text-[var(--qt-cream)] truncate max-w-[110px]">{p.name}</span>
                </span>
                <span className="block text-[11px] text-[var(--qt-mute)] mt-0.5">{statusText(p)}</span>
                {free && <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--qt-amber)] mt-1">Challenge</span>}
              </button>
            );
          })}
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(12,10,20,0.75)]" onClick={() => !sending && setPicking(null)}>
          <div
            className="w-full max-w-md rounded-t-3xl bg-[var(--qt-panel)] border-t border-[var(--qt-line)] px-4 pt-5"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-[11px] tracking-[0.3em] uppercase text-[var(--qt-mute)]">Challenge</p>
            <p className="text-center font-display text-xl text-[var(--qt-amber)] mt-1 mb-4">{picking.name}</p>
            <div className="flex flex-col gap-2">
              {GAMES.map((g) => (
                <button
                  key={g}
                  disabled={sending}
                  onClick={async () => {
                    setSending(true);
                    await challenge(picking, g);
                    setSending(false);
                    setPicking(null);
                  }}
                  className="btn-amber rounded-2xl py-4 text-lg font-bold uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-50"
                >
                  {GAME_LABELS[g]}
                </button>
              ))}
              <button onClick={() => setPicking(null)} disabled={sending} className="py-2 text-sm text-[var(--qt-mute)]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
