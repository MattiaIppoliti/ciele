import { readConversationsForExportOp } from "@ciele/ops";
import { MAX_AGENT_ITERATIONS } from "@agent-hub/agent/client";
import { z } from "zod";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { conversationExportRows } from "@/lib/inbox/conversation-export";
import { canViewReasoning } from "@/lib/rbac";

/**
 * Message-level export (#624): the same 29-field records as the admin app's
 * Inbox export (#561). Body: { conversationIds: string[] } (≤500). The
 * reasoning gate is enforced by the key's Role, never by a request flag.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const parsed = z
    .object({
      conversationIds: z.array(z.string().min(1)).min(1).max(500),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      "invalid_input",
      "conversationIds must contain between 1 and 500 ids",
    );
  }

  const outcome = await runApiOperation(request, readConversationsForExportOp, {
    query: { conversationIds: parsed.data.conversationIds },
    limit: 500,
  });
  if (outcome instanceof Response) return outcome;

  const rows = conversationExportRows(outcome.result.rows, {
    includeReasoning: canViewReasoning(outcome.ctx.role),
    iterationLimit: MAX_AGENT_ITERATIONS,
  });
  return Response.json({ data: rows });
}
