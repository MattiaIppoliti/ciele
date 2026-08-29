import { listInboxPageOp } from "@ciele/ops";
import { parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * The conversation Inbox, read-only (#624): every member-tier key may list.
 * Optional `?assistantId=` narrows to one Assistant; cursor pagination as
 * everywhere else.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const assistantId = url.searchParams.get("assistantId");
  const pageParams = parseListParams(url);
  const outcome = await runApiOperation(request, listInboxPageOp, {
    ...pageParams,
    ...(assistantId ? { assistantId } : {}),
  });
  if (outcome instanceof Response) return outcome;

  return Response.json({
    data: outcome.result.conversations,
    nextCursor: outcome.result.nextCursor,
  });
}
