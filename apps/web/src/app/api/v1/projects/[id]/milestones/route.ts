import { listMilestonesOp, setMilestonesOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * A Project's milestones (#1069), the Timeline's diamonds. PUT replaces the
 * whole list, so a client sends back every milestone it means to keep.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listMilestonesOp, { id });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setMilestonesOp, {
    id,
    milestones: (body as { milestones?: unknown }).milestones,
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
