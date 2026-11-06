import { listAuditLogOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Organization audit log, newest first. Read-only: operations write every
 * entry as they run, so there is no route that writes one. A bare date is a
 * whole UTC day, the same reading as the console's date filter.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const text = (name: string) => params.get(name) || undefined;
  const operations = (params.get("action") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const from = text("from");
  const to = text("to");
  const limit = params.get("limit");
  const outcome = await runApiOperation(request, listAuditLogOp, {
    ...(operations.length > 0 ? { operations } : {}),
    ...(text("actor") ? { memberId: text("actor") } : {}),
    ...(text("domain") ? { domain: text("domain") } : {}),
    ...(from ? { from: from && DAY.test(from) ? `${from}T00:00:00.000Z` : from } : {}),
    ...(to ? { to: to && DAY.test(to) ? `${to}T23:59:59.999Z` : to } : {}),
    ...(text("order") ? { order: text("order") } : {}),
    ...(text("before") ? { before: text("before") } : {}),
    ...(text("beforeId") ? { beforeId: text("beforeId") } : {}),
    ...(text("after") ? { after: text("after") } : {}),
    ...(text("afterId") ? { afterId: text("afterId") } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
