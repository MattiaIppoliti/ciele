import { requestApplicationReconsentOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

/**
 * Re-consent is a browser round-trip the provider owns; this endpoint computes
 * the scope union and returns the OAuth start path (on this deployment's
 * origin) that completes it. The callback route updates the row in place.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const input = await request.json().catch(() => ({}));
  if (typeof input !== "object" || input === null) {
    return apiError(400, "invalid_input", "Body must be JSON");
  }
  const outcome = await runApiOperation(request, requestApplicationReconsentOp, {
    id,
    ...(input as Record<string, unknown>),
  });
  if (outcome instanceof Response) return outcome;
  const origin = new URL(request.url).origin;
  return Response.json({
    ...outcome.result,
    startUrl: `${origin}${outcome.result.startPath}`,
  });
}
