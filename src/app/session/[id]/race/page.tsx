import RaceRoom from './race-room';

export default async function RacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seed?: string }>;
}) {
  const { id } = await params;
  const { seed } = await searchParams;
  return (
    <RaceRoom
      // Remount on rematch: a new seed must rebuild players, recording, and scene
      key={seed}
      sessionId={id}
    />
  );
}
