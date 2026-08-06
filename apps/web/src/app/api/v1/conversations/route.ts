import { listInboxConversationsOp } from "@ciele/ops";
import { paginate, parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * The conversation Inbox, read-only (#624): every member-tier key may list.
 * Optional `?assistantId=` narrows to one Assistant; cursor pagination as
 * everywhere else.
 */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listInboxConversationsOp, {});
  if (outcome instanceof Response) return outcome;

  const url = new URL(request.url);
  const assistantId = url.searchParams.get("assistantId");
  const conversations = assistantId
    ? outcome.result.filter((c) => c.assistantId === assistantId)
    : outcome.result;

  const page = paginate(conversations, parseListParams(url));
  return Response.json({ data: page.data, nextCursor: page.nextCursor });
}
