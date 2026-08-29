import { duplicateAssistantOp } from "@ciele/ops";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { assistantResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Duplicate an Assistant (#620): config + Flows copied, knowledge stays,
 * the same operation behind the dashboard card's "Duplicate assistant".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await idempotencyScope(request, `POST /assistants/${id}/duplicate`);
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, duplicateAssistantOp, { id });
    if (outcome instanceof Response) return outcome;
    return Response.json(assistantResource(outcome.result), { status: 201 });
  });
}
