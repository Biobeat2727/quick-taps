'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';

// Client-only: WebGL + Rapier + Ably
const BowlingRoom = dynamic(() => import('./bowling-room'), { ssr: false });

export default function BowlingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BowlingRoom sessionId={id} />;
}
