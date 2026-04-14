import {
  getSession,
  setSession,
  deleteSession,
  removeSessionFromIndex,
} from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { z } from "zod";

const LeaveSchema = z.object({
  playerId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = LeaveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { playerId } = parsed.data;

  // Notify session subscribers before potentially deleting
  const sessionChannel = ablyRest.channels.get(CHANNELS.session(id));
  await sessionChannel.publish("player:left", { playerId });

  session.players = session.players.filter((p) => p.id !== playerId);

  if (session.players.length === 0) {
    await deleteSession(id);
    await removeSessionFromIndex(id);
  } else {
    session.lastActivity = Date.now();
    await setSession(session);
  }

  const sessionsChannel = ablyRest.channels.get(CHANNELS.sessions());
  await sessionsChannel.publish("session:list:updated", null);

  return new Response(null, { status: 204 });
}
