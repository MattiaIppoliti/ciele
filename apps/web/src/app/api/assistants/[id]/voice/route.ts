import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getVoiceCatalog } from "@/lib/voice-providers";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.organization) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const { id } = await params;
  const assistant = await db.getAssistant(id);
  if (!assistant || assistant.organizationId !== session.organization.id) return Response.json({ error: "Not found" }, { status: 404 });
  const catalog = await getVoiceCatalog(await db.listProviderConnections(session.organization.id));
  return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
}
