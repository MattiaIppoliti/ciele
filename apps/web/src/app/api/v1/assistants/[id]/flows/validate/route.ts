import { proposeFlowOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Check a whole Flow without creating it, and see what would be stored.
 *
 * The same operation the Flows Agent proposes with, which is why the body
 * carries a `rationale`: it is one sentence on why this belongs in its own
 * Flow, and it comes back with the proposal. Mutates nothing.
 *
 * Worth a call before `POST /assistants/{id}/flows` for the same reason
 * `/flows/draft` is: the structural schema refuses a bad Flow, but only this
 * shows the human-review action the runtime inserts ahead of a Connector
 * write (#841).
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, proposeFlowOp, {
    assistantId: id,
    ...body,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
