import { createBusinessHoursOp, listBusinessHoursOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listBusinessHoursOp, {});
  return outcome instanceof Response ? outcome : Response.json({ available: outcome.result.available, defaultTimezone: outcome.result.defaultTimezone, data: outcome.result.items });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createBusinessHoursOp, body);
  return outcome instanceof Response ? outcome : Response.json(outcome.result, { status: 201 });
}
