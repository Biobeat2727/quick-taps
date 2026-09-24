'use client';

// Big-ball cue-tip picker. Drag the chalk mark anywhere inside the safe zone;
// the text underneath explains what that hit will do.

import { useRef } from 'react';

export type Spin = { x: number; y: number }; // x: −1 left … +1 right english; y: −1 draw … +1 follow

const SAFE = 0.72; // fraction of the radius you can hit before it's a miscue

const strength = (v: number) => (Math.abs(v) < 0.45 ? 'a touch of' : Math.abs(v) < 0.8 ? 'medium' : 'max');

export function describeSpin({ x, y }: Spin): { title: string; lines: string[] } {
  const vert = Math.abs(y) < 0.12 ? null : y > 0 ? 'FOLLOW' : 'DRAW';
  const side = Math.abs(x) < 0.12 ? null : x > 0 ? 'RIGHT' : 'LEFT';
  const title = !vert && !side ? 'CENTER BALL' : [vert, side && `${side} ENGLISH`].filter(Boolean).join(' + ');
  const lines: string[] = [];
  if (!vert) lines.push('Stun: on a straight-in shot the cue ball stops dead; on a cut it slides off at a right angle.');
  else if (vert === 'FOLLOW') lines.push(`${strength(y)[0].toUpperCase() + strength(y).slice(1)} follow: the cue ball rolls on through after it hits.`);
  else lines.push(`${strength(y)[0].toUpperCase() + strength(y).slice(1)} draw: the cue ball spins back toward you after it hits.`);
  if (side) lines.push(`${strength(x)[0].toUpperCase() + strength(x).slice(1)} ${side.toLowerCase()} english: it kicks ${side.toLowerCase()} off the cushions.`);
  else lines.push('No english: true angles off the rails.');
  return { title, lines };
}

export function SpinBadge({ spin, onClick }: { spin: Spin; onClick: () => void }) {
  const label = Math.abs(spin.x) < 0.12 && Math.abs(spin.y) < 0.12 ? 'CENTER'
    : `${Math.abs(spin.y) < 0.12 ? 'STUN' : spin.y > 0 ? 'FOLLOW' : 'DRAW'}${Math.abs(spin.x) < 0.12 ? '' : spin.x > 0 ? ' · R' : ' · L'}`;
  return (
    <button aria-label="Choose where the cue hits the ball" className="flex items-center gap-2 shrink-0" onClick={onClick}>
      <span className="relative rounded-full block" style={{ width: 44, height: 44, background: 'radial-gradient(circle at 35% 30%, #fff, #d4cec5)', boxShadow: '0 0 12px rgba(63,242,255,0.5)' }}>
        <span className="absolute rounded-full" style={{
          width: 10, height: 10, left: `calc(50% + ${spin.x * SAFE * 50}% - 5px)`, top: `calc(50% - ${spin.y * SAFE * 50}% - 5px)`,
          background: '#1fb4ff', boxShadow: '0 0 6px #3ff2ff',
        }} />
      </span>
      <span className="text-[9px] tracking-[0.12em] w-14 text-left leading-tight" style={{ color: 'rgba(210,195,255,0.85)' }}>{label}</span>
    </button>
  );
}

export function SpinPicker({ value, onChange, onClose }: { value: Spin; onChange: (s: Spin) => void; onClose: () => void }) {
  const ball = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFrom = (clientX: number, clientY: number) => {
    const r = ball.current!.getBoundingClientRect();
    let nx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
    let ny = -(clientY - (r.top + r.height / 2)) / (r.height / 2);
    const d = Math.hypot(nx, ny);
    if (d > SAFE) { nx *= SAFE / d; ny *= SAFE / d; }
    onChange({ x: nx / SAFE, y: ny / SAFE });
  };

  const { title, lines } = describeSpin(value);

  return (
    <div role="dialog" aria-label="Cue tip position" className="fixed inset-0 z-40 flex flex-col items-center justify-center px-6"
      style={{ background: 'rgba(6,4,11,0.82)', backdropFilter: 'blur(3px)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <p className="text-[11px] tracking-[0.35em] mb-4" style={{ color: 'rgba(200,180,255,0.7)' }}>WHERE DOES THE CUE HIT?</p>

      <div
        ref={ball}
        className="relative rounded-full select-none"
        style={{
          width: 'min(72vw, 300px)', aspectRatio: '1', touchAction: 'none',
          background: 'radial-gradient(circle at 36% 30%, #ffffff 0%, #f3efe6 38%, #cfc8bc 75%, #a9a195 100%)',
          boxShadow: '0 0 40px rgba(63,242,255,0.25), inset -12px -18px 40px rgba(0,0,0,0.25)',
        }}
        onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} setFrom(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (dragging.current) setFrom(e.clientX, e.clientY); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        {/* miscue band */}
        <div className="absolute inset-0 rounded-full pointer-events-none" style={{
          background: `radial-gradient(circle closest-side, transparent ${SAFE * 100 - 1}%, rgba(255,42,85,0.08) ${SAFE * 100}%, rgba(255,42,85,0.16) 100%)`,
        }} />
        {/* guides */}
        {[0.33, 0.66].map((r) => (
          <div key={r} className="absolute rounded-full pointer-events-none" style={{
            inset: `${50 - r * SAFE * 50}%`, border: '1px dashed rgba(40,30,60,0.25)',
          }} />
        ))}
        <div className="absolute left-1/2 pointer-events-none" style={{ top: `${50 - SAFE * 50}%`, bottom: `${50 - SAFE * 50}%`, width: 1, background: 'rgba(40,30,60,0.22)' }} />
        <div className="absolute top-1/2 pointer-events-none" style={{ left: `${50 - SAFE * 50}%`, right: `${50 - SAFE * 50}%`, height: 1, background: 'rgba(40,30,60,0.22)' }} />
        {[
          ['FOLLOW', { left: '50%', top: '9%', transform: 'translateX(-50%)' }],
          ['DRAW', { left: '50%', bottom: '9%', transform: 'translateX(-50%)' }],
          ['LEFT', { left: '7%', top: '50%', transform: 'translateY(-50%)' }],
          ['RIGHT', { right: '7%', top: '50%', transform: 'translateY(-50%)' }],
        ].map(([t, pos]) => (
          <span key={t as string} className="absolute text-[9px] font-bold tracking-[0.2em] pointer-events-none" style={{ color: 'rgba(40,30,60,0.55)', ...(pos as object) }}>{t as string}</span>
        ))}
        {/* chalk mark */}
        <div className="absolute rounded-full pointer-events-none" style={{
          width: '15%', aspectRatio: '1',
          left: `calc(50% + ${value.x * SAFE * 50}% - 7.5%)`, top: `calc(50% - ${value.y * SAFE * 50}% - 7.5%)`,
          background: 'radial-gradient(circle at 40% 35%, #7fe0ff, #1f8fd6)', boxShadow: '0 0 14px rgba(63,242,255,0.9), 0 0 0 2px rgba(255,255,255,0.8)',
        }} />
      </div>

      <div className="mt-5 max-w-[320px] text-center min-h-[92px]">
        <p className="font-display text-[18px]" style={{ color: '#eaffff', textShadow: '0 0 10px #3ff2ff' }}>{title}</p>
        {lines.map((l) => (
          <p key={l} className="text-[13px] mt-1.5 leading-snug" style={{ color: 'rgba(230,220,255,0.85)' }}>{l}</p>
        ))}
      </div>

      <div className="flex gap-3 mt-3">
        <button className="rounded-xl px-5 py-3 text-[13px] font-bold tracking-wide" style={{ background: 'rgba(255,255,255,0.08)', color: '#eaffff', border: '1px solid rgba(200,180,255,0.3)' }}
          onClick={() => onChange({ x: 0, y: 0 })}>CENTER</button>
        <button className="btn-amber rounded-xl px-7 py-3 text-[13px] font-bold tracking-wide" onClick={onClose}>DONE</button>
      </div>
    </div>
  );
}
