import { reorderFlowsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { flowResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Reorder an Assistant's Flows (#621). Body: { orderedIds: string[] }.
 * Default behavior is pinned last by the adapter regardless of the list.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const outcome = await runApiOperation(request, reorderFlowsOp, {
    assistantId: id,
    orderedIds: body.orderedIds,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result.map(flowResource) });
}
