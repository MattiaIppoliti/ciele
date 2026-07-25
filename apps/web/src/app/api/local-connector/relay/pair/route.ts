import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createRelayPairing } from "@/lib/local-inference-relay";
import { getDb } from "@/lib/data";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  if (!(await db.getPersonalAiSubscriptionsAllowed(session.organization.id))) {
    return Response.json({ error: "personal_subscriptions_disabled" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  return Response.json(
    await createRelayPairing({
      organizationId: session.organization.id,
      userId: session.userId,
      origin,
    }),
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
