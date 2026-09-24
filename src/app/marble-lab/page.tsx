'use client';

import dynamic from 'next/dynamic';

// Client-only: the lab simulates the race in the browser on mount.
const MarbleLab = dynamic(() => import('@/components/game/marble-race/MarbleLab').then((m) => m.MarbleLab), { ssr: false });

export default function MarbleLabPage() {
  return <MarbleLab />;
}
