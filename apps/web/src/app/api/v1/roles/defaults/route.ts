import { setRoleDefaultsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/** Which Role new invitations and new Assistant assignments start with. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setRoleDefaultsOp, body);
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
