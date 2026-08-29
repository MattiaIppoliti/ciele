import { createOrgApiKeyOp, listOrgApiKeysOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listOrgApiKeysOp, {});
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createOrgApiKeyOp, body);
  return outcome instanceof Response
    ? outcome
    : Response.json(outcome.result, { status: 201 });
}
