import { deleteProjectOp, getProjectOp, updateProjectOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * One Project. GET returns the row **and** its memory document with history,
 * because the document is the Project as far as a Teammate is concerned and
 * splitting them would make every reader issue two calls.
 *
 * DELETE is the destructive one: decisions cascade with it and attached
 * Teammates detach. Archiving (`PATCH {archived: true}`) is the move that keeps
 * the record.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getProjectOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateProjectOp, { id, patch });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteProjectOp, { id });
  return outcome instanceof Response
    ? outcome
    : new Response(null, { status: 204 });
}
