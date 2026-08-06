import { getConversationOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
import { canViewReasoning } from "@/lib/rbac";

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
