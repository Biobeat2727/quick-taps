import { z } from "zod";
import { removePlayer } from "@/lib/session/remove-player";

const LeaveSchema = z.object({
  playerId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const parsed = LeaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ok = await removePlayer(id, parsed.data.playerId, "left");
  if (!ok) return Response.json({ error: "Session not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
