import { listTeammateThreadOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

/**
 * The key holder's own thread with one Teammate. An API key acts as the Member
 * who minted it, so "my conversations" is well defined here; nobody reads a
 * colleague's internal chat through it (#768).
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listTeammateThreadOp, { id });
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}
