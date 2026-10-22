import { createTaskCommentOp, listTaskCommentsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * A Task's comments (#1069), oldest first, each with its reactions. A key
 * comments as the Member who minted it; mention someone as
 * `@[Name](member:<userId>)` to notify them.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listTaskCommentsOp, { taskId: id });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createTaskCommentOp, { taskId: id, body: (body as { body?: unknown }).body });
  return outcome instanceof Response ? outcome : Response.json(outcome.result, { status: 201 });
}
