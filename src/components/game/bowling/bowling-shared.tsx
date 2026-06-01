'use client';

import type { BowlingRawRecording, BowlingDecodedRecording } from '@/types/bowling';

export type BowlingPhase = 'aiming' | 'throwing' | 'replay' | 'results';

export function decodeRecording(raw: BowlingRawRecording): BowlingDecodedRecording {
  const toBinary = (b64: string): ArrayBuffer => {
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
  };

  return {
    numFrames: raw.numFrames,
    ballFrames: new Float32Array(toBinary(raw.ballFramesBase64)),
    pinFrames: new Float32Array(toBinary(raw.pinFramesBase64)),
    knockedPins: raw.knockedPins,
  };
}

export function ScoreCard({ players }: { players: { id: string; name: string }[] }) {
  return (
    <div className="flex gap-2 p-2">
      {players.map(p => (
        <div key={p.id} className="text-white text-sm font-medium">{p.name}</div>
      ))}
    </div>
  );
}
