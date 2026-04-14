import {
  getSession,
  deleteSession,
  removeSessionFromIndex,
} from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return Response.json(session);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteSession(id);
  await removeSessionFromIndex(id);

  const channel = ablyRest.channels.get(CHANNELS.sessions());
  await channel.publish("session:list:updated", null);

  return new Response(null, { status: 204 });
}
