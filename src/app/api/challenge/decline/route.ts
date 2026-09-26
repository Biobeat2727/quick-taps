import { z } from 'zod';
import { ablyRest } from '@/lib/ably/server';
import { CHANNELS } from '@/lib/ably/channels';

const Schema = z.object({
  fromId: z.string().min(1).max(64),  // the challenger to tell
  byName: z.string().min(1).max(32),
  sessionId: z.string().min(1),
});

/** "Not now" — lets the challenger know. Their table stays open for anyone. */
export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const { fromId, byName, sessionId } = parsed.data;
  await ablyRest.channels.get(CHANNELS.inbox(fromId)).publish('challenge:declined', { sessionId, byName });
  return new Response(null, { status: 204 });
}
