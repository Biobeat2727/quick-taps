import { randomUUID } from "crypto";
import { listSessions, setSession, addSessionToIndex } from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { z } from "zod";

const CreateSchema = z.object({
  game: z.enum(["marble_race"]),
  playerName: z.string().min(1).max(32),
  playerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export async function GET() {
  try {
    const sessions = await listSessions();
    return Response.json(sessions);
  } catch (error) {
    console.error("GET /api/sessions error:", error);
    return Response.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { game, playerName, playerColor } = parsed.data;
    const now = Date.now();

    const session = {
      id: randomUUID(),
      game,
      createdAt: now,
      lastActivity: now,
      players: [
        {
          id: randomUUID(),
          name: playerName,
          color: playerColor,
          isNpc: false as const,
        },
      ],
    };

    await setSession(session);
    await addSessionToIndex(session.id);

    const channel = ablyRest.channels.get(CHANNELS.sessions());
    await channel.publish("session:list:updated", null);

    return Response.json(session, { status: 201 });
  } catch (error) {
    console.error("POST /api/sessions error:", error);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
