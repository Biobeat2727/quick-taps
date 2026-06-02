import BowlingRoom from './bowling-room';

export default async function BowlingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BowlingRoom sessionId={id} />;
}
