import { listSourceDocumentsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const outcome = await runApiOperation(request, listSourceDocumentsOp, { sourceId: id, page: query.has("page") ? Number(query.get("page")) : undefined, pageSize: query.has("pageSize") ? Number(query.get("pageSize")) : undefined, status: query.get("status") ?? undefined, trustTier: query.get("trustTier") ?? undefined });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
