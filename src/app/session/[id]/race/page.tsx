import RaceRoom from './race-room';

export default async function RacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RaceRoom sessionId={id} />;
}
