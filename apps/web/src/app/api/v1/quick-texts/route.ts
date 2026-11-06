import { createQuickTextOp, listQuickTextsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** Quick Texts (#1085): the Organization's saved replies for the Inbox. */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listQuickTextsOp, {});
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createQuickTextOp, body);
  return outcome instanceof Response
    ? outcome
    : Response.json(outcome.result, { status: 201 });
}
