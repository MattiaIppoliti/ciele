import { deleteEntityOp, getEntityOp, updateEntityOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getEntityOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateEntityOp, { id, patch });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteEntityOp, { id });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
