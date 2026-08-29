import { deleteConversationOp, getConversationOp, setConversationPinnedOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { canViewReasoning } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

/**
 * One Conversation's transcript (#624). The stored trace quotes the
 * Visitor's message and retrieved knowledge verbatim (#557), so it is served
 * only to keys whose Role clears the same reasoning gate as the Inbox UI;
 * below it the messages arrive without `trace`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getConversationOp, { id });
  if (outcome instanceof Response) return outcome;

  const includeTrace = canViewReasoning(outcome.ctx.role);
  const { conversation, messages } = outcome.result;
  return Response.json({
    conversation,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      flowId: m.flowId,
      flowName: m.flowName,
      feedback: m.feedback,
      createdAt: m.createdAt,
      ...(includeTrace ? { trace: m.trace } : {}),
    })),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setConversationPinnedOp, {
    id,
    pinned: body.pinned,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteConversationOp, { id });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
