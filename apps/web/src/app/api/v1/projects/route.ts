import { createProjectOp, listProjectsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Projects (#771): the shared workspace a Teammate can be attached to, and the
 * owner of the Project memory layer.
 *
 * A Project is org-scoped, so unlike the User memory layer it is a fair thing
 * for a key to read and write: nothing here is private to one Member.
 */

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listProjectsOp, {});
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createProjectOp, body);
  return outcome instanceof Response
    ? outcome
    : Response.json(outcome.result, { status: 201 });
}
