export const runtime = 'nodejs';

import { redis } from '@/lib/redis/client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const throwIndex = new URL(request.url).searchParams.get('throwIndex');
  if (!throwIndex) return Response.json({ error: 'Missing throwIndex' }, { status: 400 });

  const data = await redis.get(`qt:bowl:recording:${id}:${throwIndex}`);
  if (!data) return Response.json({ error: 'Recording not found' }, { status: 404 });

  return Response.json(data);
}
