import RaceRoom from './race-room';

export default async function RacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; seed?: string }>;
}) {
  const { id } = await params;
  const { mode, seed } = await searchParams;
  return (
    <RaceRoom
      // Remount on rematch: a new seed must rebuild players, recording, and scene
      key={`${mode}-${seed}`}
      sessionId={id}
      mode={mode === '2d' ? '2d' : '3d'}
      seed={seed ? parseInt(seed, 10) : 0}
    />
  );
}
