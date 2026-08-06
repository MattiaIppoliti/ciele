import { deleteFlowOp, getFlowOp, updateFlowOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { flowResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/** One Flow (#621): read, patch (incl. enable/disable), delete. */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getFlowOp, { id });
  if (outcome instanceof Response) return outcome;
  return Response.json(flowResource(outcome.result));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");

  const outcome = await runApiOperation(request, updateFlowOp, { id, patch });
  if (outcome instanceof Response) return outcome;
  return Response.json(flowResource(outcome.result));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteFlowOp, { id });
  if (outcome instanceof Response) return outcome;
  return new Response(null, { status: 204 });
}
