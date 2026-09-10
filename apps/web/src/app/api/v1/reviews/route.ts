import { listReviewsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** Human review requests (#841), newest first. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const conversationId = url.searchParams.get("conversationId") ?? undefined;
  const assistantId = url.searchParams.get("assistantId") ?? undefined;
  const outcome = await runApiOperation(request, listReviewsOp, {
    ...(status ? { status } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(assistantId ? { assistantId } : {}),
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
