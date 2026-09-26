import Ably from "ably";
import { CHANNELS } from "@/lib/ably/channels";

const globalForAbly = globalThis as unknown as { ablyRest: Ably.Rest };

function getAblyRest(): Ably.Rest {
  if (globalForAbly.ablyRest) return globalForAbly.ablyRest;
  const client = new Ably.Rest({ key: process.env.ABLY_API_KEY });
  if (process.env.NODE_ENV !== "production") globalForAbly.ablyRest = client;
  return client;
}

export const ablyRest: Ably.Rest = new Proxy({} as Ably.Rest, {
  get(_target, prop) {
    return (getAblyRest() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function createAblyToken(
  playerId: string,
  sessionId?: string,
  lobby = false,
): Promise<Ably.TokenDetails> {
  const capabilities: Record<string, string[]> = {
    "qt:sessions": ["subscribe"],
  };
  if (sessionId) {
    capabilities[`qt:session:${sessionId}`] = ["subscribe", "publish"];
  }
  if (lobby) {
    // Presence at the bar + this device's own challenge inbox (server publishes)
    capabilities[CHANNELS.lobby()] = ["subscribe", "presence"];
    // history: the inbox rewinds on (re)connect so a blip doesn't eat a challenge
    capabilities[`qt:inbox:${playerId}`] = ["subscribe", "history"];
  }

  const tokenRequest = await getAblyRest().auth.requestToken({
    clientId: playerId,
    capability: JSON.stringify(capabilities),
    ttl: 4 * 60 * 60 * 1000, // 4 hours
  });

  return tokenRequest;
}
