import { listImprovementsPageOp } from "@ciele/ops";
import { parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** The board filters a caller may pass; zod rejects a bad value with a 422. */
const FILTER_PARAMS = ["search", "status", "priority", "projectId", "assistantId"] as const;

/**
 * The Improvements kanban, listed (#625). Filters run before pagination, and
 * `counts` sizes every stage under the same filters. An empty `assigneeId`
 * lists unassigned work. `src/v1.rs` in the Rust service answers the same.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string | null> = {};
  for (const key of FILTER_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) filters[key] = value;
  }
  if (url.searchParams.has("assigneeId")) {
    filters.assigneeId = url.searchParams.get("assigneeId") || null;
  }
  const outcome = await runApiOperation(request, listImprovementsPageOp, {
    ...parseListParams(url),
    ...filters,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({
    data: outcome.result.items,
    nextCursor: outcome.result.nextCursor,
    counts: outcome.result.counts,
  });
}
