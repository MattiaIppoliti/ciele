import { agUiResponse, parseAgUiTurn } from "@agent-hub/agent";
import { canViewTeammate } from "@agent-hub/core";
import { resolveApiKeyContext } from "@/lib/api-v1/auth";
import { getApiV1Db } from "@/lib/api-v1/db";
import { streamTransportTeammateTurn } from "@/lib/teammates/transport";
import { perKeyThrottle } from "@/lib/api-v1/throttle";
import { apiError } from "@/lib/api-v1/http";

export const maxDuration = 300;
const throttle = perKeyThrottle("assistant-ask", {
  limit: 20,
  message: "Too many Teammate runs for this API key",
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  const throttled = throttle(ctx);
  if (throttled) return throttled;
  let parsed: ReturnType<typeof parseAgUiTurn>;
  try {
    parsed = parseAgUiTurn(await request.json());
  } catch {
    return apiError(
      422,
      "invalid_input",
      "Invalid AG-UI run; send a text user message with no frontend tools, context or resume entries",
    );
  }
  const { id } = await params;
  const teammate = await ctx.db.table("teammates").get(id);
  if (
    !teammate ||
    teammate.deletedAt ||
    !canViewTeammate(teammate, { userId: ctx.actorUserId, role: ctx.role })
  ) {
    return apiError(404, "not_found", "Teammate not found");
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const stream = await streamTransportTeammateTurn({
    db: ctx.db,
    systemDb: getApiV1Db(),
    teammate,
    memberId: ctx.actorUserId,
    role: ctx.role,
    message: parsed.message,
    threadId: `ag-ui:${parsed.input.threadId}`,
    turnId: parsed.input.runId,
    signal,
  });
  return agUiResponse(stream, parsed.input, () => controller.abort());
}
