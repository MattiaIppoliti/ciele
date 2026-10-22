import { createTaskOp, listTasksOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Tasks (#1069): the work inside Projects. A key reads only the Projects its
 * Member can read, so a private Project's Tasks are absent rather than refused.
 *
 * `GET /tasks?projectId=&assignee=&status=to_do,in_progress&label=&dueFrom=&dueTo=&q=&improvementId=&includeArchived=true&limit=&cursor=`
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const text = (name: string) => params.get(name) ?? undefined;
  const status = params.get("status");
  const limit = params.get("limit");
  const outcome = await runApiOperation(request, listTasksOp, {
    projectId: text("projectId"),
    assigneeMemberId: text("assignee"),
    status: status ? status.split(",").filter(Boolean) : undefined,
    labelId: text("label"),
    dueFrom: text("dueFrom"),
    dueTo: text("dueTo"),
    q: text("q"),
    improvementId: text("improvementId"),
    includeArchived: params.get("includeArchived") === "true" || undefined,
    limit: limit ? Number(limit) : undefined,
    cursor: text("cursor"),
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result.items, nextCursor: outcome.result.nextCursor });
}

export async function POST(request: Request) {
  // A retried create must replay the first Task, not number a second one.
  const scope = await idempotencyScope(request, "POST /tasks");
  return withIdempotency(request, scope, async () => {
    const body = await request.json().catch(() => null);
    if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
    const outcome = await runApiOperation(request, createTaskOp, body);
    return outcome instanceof Response ? outcome : Response.json(outcome.result, { status: 201 });
  });
}
