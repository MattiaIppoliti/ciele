import { searchKnowledgeOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { perKeyThrottle } from "@/lib/api-v1/throttle";

/**
 * Search the Organization's knowledge and get the passages back, not an
 * answer: the door for a caller that brings its own model (an MCP client, a
 * script). `assistantId` narrows the search to that Assistant's linked
 * Sources; without it the whole Library is searched.
 *
 * Budgeted per key, because every call embeds the query and reranks the
 * candidates on the Organization's connections.
 */

const throttle = perKeyThrottle("knowledge-search", {
  limit: 60,
  message: "Too many searches for this API key",
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return apiError(400, "invalid_input", "Body must be JSON");
  }
  const outcome = await runApiOperation(
    request,
    searchKnowledgeOp,
    { query: body.query, assistantId: body.assistantId ?? undefined },
    { throttle }
  );
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}
