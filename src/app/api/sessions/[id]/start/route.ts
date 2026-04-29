import { randomUUID } from "crypto";
import { getSession, setSession } from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { NPC_NAMES, MARBLE_COLORS } from "@/lib/constants";
import { simulateRace } from "@/lib/physics/simulate-race";
import { redis } from "@/lib/redis/client";
import { z } from "zod";

export const runtime = 'nodejs';

const RECORDING_TTL = 10 * 60; // 10 minutes — matches session TTL

const StartSchema = z.object({
  playerId: z.string().min(1),
  mode: z.enum(['2d', '3d']),
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
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (session.players[0]?.id !== parsed.data.playerId) {
    return Response.json({ error: "Not the session creator" }, { status: 403 });
  }

  // NPC fill: if solo, pad to 6 with NPCs
  if (session.players.length === 1) {
    const takenColors = new Set(session.players.map((p) => p.color));
    const available = MARBLE_COLORS.filter((c) => !takenColors.has(c.hex));
    let npcIndex = 0;
    while (session.players.length < 6 && npcIndex < NPC_NAMES.length) {
      session.players.push({
        id: randomUUID(),
        name: NPC_NAMES[npcIndex],
        color: available[npcIndex % available.length].hex,
        isNpc: true,
      });
      npcIndex++;
    }
  }

  session.lastActivity = Date.now();
  await setSession(session);

  // Run the physics simulation server-side and store the recording.
  // All clients will replay this identical recording — no physics on the client.
  const raceSeed = Math.floor(Math.random() * 2 ** 32);
  const recording = await simulateRace(session.players, raceSeed);
  await redis.set(`qt:race:recording:${id}`, recording, { ex: RECORDING_TTL });

  const channel = ablyRest.channels.get(CHANNELS.session(id));
  await channel.publish("game:started", {
    sessionId: id,
    mode: parsed.data.mode,
    seed: raceSeed,
  });

  return Response.json(session);
}
