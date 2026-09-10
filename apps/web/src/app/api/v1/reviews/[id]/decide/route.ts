import { decideReviewOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

/**
 * Decide a Human review (#841). A key has no email to match an assignee with,
 * so only an Owner/Admin key gets past the operation's assignee rule.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const input = await request.json().catch(() => ({}));
  if (typeof input !== "object" || input === null) {
    return apiError(400, "invalid_input", "Body must be JSON");
  }
  const outcome = await runApiOperation(request, decideReviewOp, {
    id,
    ...(input as Record<string, unknown>),
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result.review);
}
