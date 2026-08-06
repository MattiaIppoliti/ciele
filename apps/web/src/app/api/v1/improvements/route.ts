import { listImprovementsOp } from "@ciele/ops";
import { paginate, parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** The Improvements kanban, listed (#625). */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listImprovementsOp, {});
  if (outcome instanceof Response) return outcome;
  const page = paginate(outcome.result, parseListParams(new URL(request.url)));
  return Response.json({ data: page.data, nextCursor: page.nextCursor });
}
