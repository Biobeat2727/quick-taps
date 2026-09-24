'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';

// Client-only: WebGL + Ably
const PoolRoom = dynamic(() => import('./pool-room'), { ssr: false });

export default function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PoolRoom sessionId={id} />;
}
