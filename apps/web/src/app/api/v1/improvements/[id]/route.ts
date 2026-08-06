import { getImprovementOp, updateImprovementOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** One Improvement (#625): detail (associated messages + proposal) + update. */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getImprovementOp, { id });
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");

  const outcome = await runApiOperation(request, updateImprovementOp, { id, patch });
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}
