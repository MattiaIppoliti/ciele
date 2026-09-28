import { askAssistantOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
import { perKeyThrottle } from "@/lib/api-v1/throttle";

/**
 * Ask an Assistant a question and get its answer back whole, with the Sources
 * it cited: the door for a caller with no model of its own. The real turn on
 * the latest Publication, so the answer is the one the widget would give.
 * Pass the returned `conversationId` back to ask a follow-up in the thread.
 *
 * The caller holds the socket for the whole turn, retrieval and tool calls
 * included, so this is the one v1 route with the widget's `maxDuration`. And
 * it is budgeted per key, tighter than search, because every call is a model
 * turn on the Organization's connections.
 */

export const maxDuration = 300;

const throttle = perKeyThrottle("assistant-ask", {
  limit: 20,
  message: "Too many questions for this API key",
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return apiError(400, "invalid_input", "Body must be JSON");
  }
  const outcome = await runApiOperation(
    request,
    askAssistantOp,
    { id, question: body.question, conversationId: body.conversationId ?? undefined },
    { throttle }
  );
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}
