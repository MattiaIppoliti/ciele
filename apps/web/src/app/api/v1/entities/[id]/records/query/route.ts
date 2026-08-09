import { queryEntityRecordsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = await request.json().catch(() => null);
  if (query === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, queryEntityRecordsOp, { entityId: id, query });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
