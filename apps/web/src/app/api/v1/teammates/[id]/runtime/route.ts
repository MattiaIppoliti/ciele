import { configureTeammateRuntimeOp, getTeammateOp } from "@ciele/ops";
import { teammateExecutionOptions } from "@agent-hub/agent";
import { teammateRuntimeConfig } from "@agent-hub/core";
import { runApiOperation } from "@/lib/api-v1/run";
import { apiError } from "@/lib/api-v1/http";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getTeammateOp, { id });
  return outcome instanceof Response
    ? outcome
    : Response.json({
        config: teammateRuntimeConfig(outcome.result),
        ...teammateExecutionOptions(outcome.ctx.organizationId),
      });
}
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  let config: unknown;
  try {
    config = await request.json();
  } catch {
    return apiError(400, "invalid_input", "Invalid JSON");
  }
  const outcome = await runApiOperation(request, configureTeammateRuntimeOp, {
    id,
    config,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
