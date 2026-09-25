'use client';

// Speaker button — mutes/unmutes every game's sound on this phone.

import { useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setMuted } from '@/lib/audio/sfx';

export function SoundToggle({ style, className = '' }: { style?: React.CSSProperties; className?: string }) {
  const muted = useSyncExternalStore(onMuteChange, isMuted, () => false);

  return (
    <button
      type="button"
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      aria-pressed={muted}
      onClick={() => setMuted(!muted)}
      className={`flex items-center justify-center rounded-full ${className}`}
      style={{
        width: 36, height: 36, background: 'rgba(10,8,18,0.72)',
        border: '1px solid rgba(255,255,255,0.14)', color: muted ? '#8e86a0' : '#f5eddf',
        ...style,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
        {muted ? (
          <>
            <line x1="16" y1="9" x2="22" y2="15" />
            <line x1="22" y1="9" x2="16" y2="15" />
          </>
        ) : (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        )}
      </svg>
    </button>
  );
}
