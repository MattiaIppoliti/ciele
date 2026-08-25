import { readTeammateConversationOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, conversationId } = await params;
  const outcome = await runApiOperation(request, readTeammateConversationOp, {
    id,
    conversationId,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
