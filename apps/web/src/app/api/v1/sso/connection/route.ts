import {
  disconnectSsoConnectionOp,
  getSsoConnectionOp,
  setSsoConnectionOp,
} from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, getSsoConnectionOp, {});
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setSsoConnectionOp, body);
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request) {
  const outcome = await runApiOperation(request, disconnectSsoConnectionOp, {});
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
