import { readFlowsAgentConversationOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** One Flows Agent conversation with its turns; the key holder's own only. */

type Params = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, conversationId } = await params;
  const outcome = await runApiOperation(request, readFlowsAgentConversationOp, {
    assistantId: id,
    conversationId,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
