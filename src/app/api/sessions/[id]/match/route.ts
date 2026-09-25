export const runtime = 'nodejs';

import { getMatch } from '@/lib/match/match-server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) return Response.json({ error: 'No match' }, { status: 404 });
  return Response.json({ ...match, serverNow: Date.now() });
}
