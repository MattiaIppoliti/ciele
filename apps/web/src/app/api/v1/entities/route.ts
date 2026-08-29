import { createEntityOp, listEntitiesPageOp } from "@ciele/ops";
import { apiError, parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(
    request,
    listEntitiesPageOp,
    parseListParams(new URL(request.url))
  );
  if (outcome instanceof Response) return outcome;
  return Response.json({
    data: outcome.result.items,
    nextCursor: outcome.result.nextCursor,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createEntityOp, body);
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result, { status: 201 });
}
