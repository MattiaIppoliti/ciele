import { deleteTaskLabelOp, updateTaskLabelOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * One task Label (#1069). PATCH renames or recolours it; DELETE removes it
 * from every Task that carries it, and the Tasks stay.
 */
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateTaskLabelOp, { id, patch: body });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteTaskLabelOp, { id });
  return outcome instanceof Response ? outcome : Response.json({ deleted: id });
}
