import { listFlowsAgentThreadOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * This key holder's conversations with the Assistant's Flows Agent about one
 * Flow. `?flowId=` omitted means the new-Flow canvas, whose conversations carry
 * no Flow id until a Save adopts them.
 *
 * A key acts as the Member who minted it, so this reads that Member's own
 * thread and nobody else's, exactly like `GET /teammates/{id}/conversations`.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listFlowsAgentThreadOp, {
    assistantId: id,
    flowId: new URL(request.url).searchParams.get("flowId"),
  });
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}
