import { createChannelOp, listChannelsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Teammate channels over an API key (#778).
 *
 * A key acts as the Member who minted it, so `list` returns that Member's own
 * channels: membership is the visibility rule here as it is in the console, and
 * a key does not get a wider view of internal threads than the person holding
 * it.
 *
 * Posting a message has no route on purpose. A message starts a chain, which is
 * a streamed, model-driven thing with its own caps; the request/response surface
 * would have to run up to ten model turns inside one HTTP call and return them
 * as a batch. The console's streaming route is where a chain belongs, and the
 * pinned Db enforces it: `appendChannelMessage` is not exposed to a key.
 */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listChannelsOp, {});
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createChannelOp, body);
  return outcome instanceof Response
    ? outcome
    : Response.json(outcome.result, { status: 201 });
}
