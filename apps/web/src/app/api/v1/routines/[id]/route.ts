import { deleteRoutineOp, updateRoutineOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * One Routine, addressed directly: the operations take only its id and reach
 * its Teammate themselves, so nesting the path would carry a second id nothing
 * reads. The same shape `/flows/{id}` has next to `/assistants/{id}/flows`.
 *
 * Both verbs run the Teammate's `canEditTeammate` rule through the routine's
 * owner, so a routine can never be changed by somebody who could not change the
 * Teammate it belongs to.
 */

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateRoutineOp, { id, patch });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteRoutineOp, { id });
  return outcome instanceof Response
    ? outcome
    : new Response(null, { status: 204 });
}
