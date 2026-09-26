import { listSessions } from "@/lib/redis/session";
import { createSession } from "@/lib/session/create-session";
import { z } from "zod";

const CreateSchema = z.object({
  game: z.enum(["marble_race", "bowling", "pool"]),
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
    const session = await createSession(game, playerName, playerColor);

    return Response.json(session, { status: 201 });
  } catch (error) {
    console.error("POST /api/sessions error:", error);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
