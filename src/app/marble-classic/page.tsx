'use client';

import dynamic from 'next/dynamic';

// Client-only: the archived map is simulated in the browser on mount.
const ClassicLab = dynamic(() => import('@/components/game/marble-race/classic/ClassicLab').then((m) => m.ClassicLab), { ssr: false });

export default function MarbleClassicPage() {
  return <ClassicLab />;
}
