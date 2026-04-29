import { redis } from '@/lib/redis/client';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await redis.get(`qt:race:recording:${id}`);
  if (!data) {
    return Response.json({ error: 'Recording not found' }, { status: 404 });
  }
  return Response.json(data);
}
