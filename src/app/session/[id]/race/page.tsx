import RaceRoom from './race-room';

export default async function RacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  return <RaceRoom sessionId={id} mode={mode === '2d' ? '2d' : '3d'} />;
}
