import { listEntityRecordsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const outcome = await runApiOperation(request, listEntityRecordsOp, {
    entityId: id,
    limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
    offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
