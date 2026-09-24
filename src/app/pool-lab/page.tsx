'use client';

import dynamic from 'next/dynamic';

// Client-only: the lab rolls a random opponent and rack on mount.
const PoolLab = dynamic(() => import('@/components/game/pool-v2/PoolLab').then((m) => m.PoolLab), { ssr: false });

export default function PoolLabPage() {
  return <PoolLab />;
}
