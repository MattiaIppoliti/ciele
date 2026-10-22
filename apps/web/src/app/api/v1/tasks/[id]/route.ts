import { deleteTaskOp, getTaskOp, updateTaskOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * One Task (#1069). GET returns it with its subtasks, labels and blockers.
 * PATCH takes `{ patch?, labelIds?, blockedBy?, position?, projectId?, archived? }`,
 * the shape the console sends (`projectId` moves it to another Project, which
 * re-numbers it; `archived` archives or restores it with its subtasks). DELETE
 * takes its subtasks, comments and files with it; archiving is the reversible
 * move.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getTaskOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateTaskOp, { ...body, id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteTaskOp, { id });
  return outcome instanceof Response ? outcome : Response.json({ deleted: outcome.result.deleted });
}
