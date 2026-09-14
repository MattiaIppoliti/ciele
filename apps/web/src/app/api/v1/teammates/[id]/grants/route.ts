import { listTeammateGrantsOp, setTeammateGrantsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * What an AI Teammate may do (#770): its granted domains, its capability
 * ceiling and its approval-bypass flag, read and replaced as one set.
 *
 * The two halves carry different capabilities on purpose, and the operations
 * are where that is enforced. Reading is a Member right, because what the
 * organization's agents may do is something the colleagues working beside them
 * should be able to check. Writing is `manageMembers`, a rung above the Editor
 * who may rename a Teammate, because arming an agent is the same kind of
 * decision as handing a person a Role.
 *
 * PUT rather than POST: grants are a set, and a set is not something to mutate
 * one element at a time across round trips that can half-fail.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listTeammateGrantsOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setTeammateGrantsOp, {
    id,
    ...body,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
