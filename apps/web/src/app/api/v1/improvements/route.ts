import { listImprovementsPageOp } from "@ciele/ops";
import { parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** The Improvements kanban, listed (#625). */
export async function GET(request: Request) {
  const outcome = await runApiOperation(
    request,
    listImprovementsPageOp,
    parseListParams(new URL(request.url))
  );
  if (outcome instanceof Response) return outcome;
  return Response.json({
    data: outcome.result.items,
    nextCursor: outcome.result.nextCursor,
  });
}
