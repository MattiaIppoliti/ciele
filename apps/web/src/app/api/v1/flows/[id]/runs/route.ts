import { listHttpFlowRunsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * The latest inbound runs of an HTTP-triggered Flow (#843): whether the
 * endpoint is being called, what it answered, and which action failed.
 *
 * Deliberately not the Inbox, because a run is not a Conversation, which is
 * also why it needs a route of its own: an operator watching a webhook has
 * nowhere else to look, and watching one from a script is the ordinary case.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const limit = Number.parseInt(
    new URL(request.url).searchParams.get("limit") ?? "",
    10
  );
  const outcome = await runApiOperation(request, listHttpFlowRunsOp, {
    flowId: id,
    ...(Number.isFinite(limit) ? { limit } : {}),
  });
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}
