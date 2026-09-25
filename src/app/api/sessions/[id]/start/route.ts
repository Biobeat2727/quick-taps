import { randomUUID } from "crypto";
import { getSession, setSession } from "@/lib/redis/session";
import { ablyRest } from "@/lib/ably/server";
import { CHANNELS } from "@/lib/ably/channels";
import { NPC_NAMES, MARBLE_COLORS } from "@/lib/constants";
import RAPIER from "@dimforge/rapier3d-compat";
import { runRaceSim, REC_HZ } from "@/lib/marble/race-sim-core";
import { after } from "next/server";
import { recordScores } from "@/lib/scores/scores";
import { getMap, DEFAULT_MAP_ID } from "@/lib/marble/maps";
import type { RaceRecording } from "@/types/race";
import { redis } from "@/lib/redis/client";
import { z } from "zod";

export const runtime = 'nodejs';

const RECORDING_TTL = 10 * 60; // 10 minutes — matches session TTL

let rapierReady: Promise<void> | null = null;

const StartSchema = z.object({
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
  session.status = "racing";
  await setSession(session);

  // Run the physics simulation server-side and store the recording.
  // All clients will replay this identical recording — no physics on the client.
  const raceSeed = Math.floor(Math.random() * 2 ** 32);
  rapierReady ??= RAPIER.init();
  await rapierReady;
  const map = getMap(DEFAULT_MAP_ID);
  const res = runRaceSim(RAPIER, map, session.players.length, raceSeed);
  const recording: RaceRecording = {
    map: map.id,
    marbles: session.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    numMarbles: res.numMarbles,
    numFrames: res.numFrames,
    framesBase64: Buffer.from(res.frames.buffer, res.frames.byteOffset, res.frames.byteLength).toString("base64"),
    finishFrame: res.finishFrame,
    ranking: res.ranking,
  };
  await redis.set(`qt:race:recording:${id}`, recording, { ex: RECORDING_TTL });

  // Leaderboard: a win counts only against another human. The race is decided
  // now but plays out over the next minute or two, so the row stays hidden
  // until the winner actually crosses the line on everyone's screen.
  const humans = session.players.filter((p) => !p.isNpc).length;
  const winIdx = res.ranking[0];
  const winner = session.players[winIdx];
  const finishFrame = res.finishFrame[winIdx];
  if (humans >= 2 && winner && !winner.isNpc && finishFrame !== null) {
    const COUNTDOWN_AND_LOAD_MS = 5_000;
    after(() => recordScores([{
      game: "marble_race", kind: "win", playerName: winner.name, value: 1, vsHumans: true,
      sessionId: id, dedupeKey: `${id}:${raceSeed}:win`,
      countsAt: new Date(Date.now() + COUNTDOWN_AND_LOAD_MS + (finishFrame / REC_HZ) * 1000),
    }]));
  }

  const channel = ablyRest.channels.get(CHANNELS.session(id));
  await channel.publish("game:started", {
    sessionId: id,
    seed: raceSeed,
  });

  // Lobby list shows racing tables as not joinable
  const sessionsChannel = ablyRest.channels.get(CHANNELS.sessions());
  await sessionsChannel.publish("session:list:updated", null);

  return Response.json(session);
}
