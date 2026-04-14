import { getSession, setSession } from "@/lib/redis/session";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  session.lastActivity = Date.now();
  await setSession(session);
  return new Response(null, { status: 204 });
}
