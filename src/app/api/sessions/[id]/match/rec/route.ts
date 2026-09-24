export const runtime = 'nodejs';

import { getRecording } from '@/lib/match/match-server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seq = Number(new URL(request.url).searchParams.get('seq'));
  if (!Number.isInteger(seq) || seq < 0) return Response.json({ error: 'Bad seq' }, { status: 400 });
  const rec = await getRecording(id, seq);
  if (!rec) return Response.json({ error: 'Recording not found' }, { status: 404 });
  return Response.json(rec);
}
