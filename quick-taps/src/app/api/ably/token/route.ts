import { createAblyToken } from "@/lib/ably/server";
import { z } from "zod";

const TokenSchema = z.object({
  playerId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = TokenSchema.safeParse({
    playerId: searchParams.get("playerId"),
    sessionId: searchParams.get("sessionId") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const token = await createAblyToken(
      parsed.data.playerId,
      parsed.data.sessionId
    );
    return Response.json(token);
  } catch (error) {
    console.error("GET /api/ably/token error:", error);
    return Response.json({ error: "Failed to create token" }, { status: 500 });
  }
}
