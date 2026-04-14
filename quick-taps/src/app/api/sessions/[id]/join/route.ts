import { randomUUID } from "crypto";
import { getSession, setSession } from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { z } from "zod";

const JoinSchema = z.object({
  playerName: z.string().min(1).max(32),
  playerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
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
  const parsed = JoinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { playerName, playerColor } = parsed.data;

  if (session.players.some((p) => p.color === playerColor)) {
    return Response.json({ error: "Color already taken" }, { status: 409 });
  }

  const player = {
    id: randomUUID(),
    name: playerName,
    color: playerColor,
    isNpc: false as const,
  };

  session.players.push(player);
  session.lastActivity = Date.now();
  await setSession(session);

  const sessionChannel = ablyRest.channels.get(CHANNELS.session(id));
  await sessionChannel.publish("player:joined", {
    playerId: player.id,
    playerName: player.name,
    color: player.color,
  });

  const sessionsChannel = ablyRest.channels.get(CHANNELS.sessions());
  await sessionsChannel.publish("session:list:updated", null);

  return Response.json({ session, player });
}
