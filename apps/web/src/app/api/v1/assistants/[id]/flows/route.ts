import { createFlowOp, listFlowsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { flowResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/** An Assistant's Flow list (#621): ordered router, same ops as the editor. */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listFlowsOp, { assistantId: id });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result.map(flowResource) });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, `POST /assistants/${id}/flows`);
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, createFlowOp, {
      assistantId: id,
      input: body,
    });
    if (outcome instanceof Response) return outcome;
    return Response.json(flowResource(outcome.result), { status: 201 });
  });
}
