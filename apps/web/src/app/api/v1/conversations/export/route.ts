import { readConversationsForExportOp } from "@ciele/ops";
import { MAX_AGENT_ITERATIONS } from "@agent-hub/agent/client";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { conversationExportRows } from "@/lib/inbox/conversation-export";
import { canViewReasoning } from "@/lib/rbac";

/**
 * Message-level export (#624): the same 29-field records as the admin app's
 * Inbox export (#561). Body: { conversationIds: string[] } (≤500). The
 * reasoning gate is enforced by the key's Role — never by a request flag.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const outcome = await runApiOperation(request, readConversationsForExportOp, {
    conversationIds: body.conversationIds,
  });
  if (outcome instanceof Response) return outcome;

  const rows = conversationExportRows(outcome.result, {
    includeReasoning: canViewReasoning(outcome.ctx.role),
    iterationLimit: MAX_AGENT_ITERATIONS,
  });
  return Response.json({ data: rows });
}
