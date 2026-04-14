import { getSession, setSession } from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { z } from "zod";

const ColorSchema = z.object({
  playerId: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = ColorSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { playerId, color } = parsed.data;

  if (session.players.some((p) => p.color === color && p.id !== playerId)) {
    return Response.json({ error: "Color already taken" }, { status: 409 });
  }

  const player = session.players.find((p) => p.id === playerId);
  if (!player) {
    return Response.json({ error: "Player not found" }, { status: 404 });
  }

  player.color = color;
  session.lastActivity = Date.now();
  await setSession(session);

  const channel = ablyRest.channels.get(CHANNELS.session(id));
  await channel.publish("player:color:changed", { playerId, color });

  return Response.json(session);
}
