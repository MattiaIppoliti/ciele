import { okfActor } from "@agent-hub/core";
import type { OperationContext } from "./operation";

/**
 * Who an OKF write records as its author (#770).
 *
 * One function because the answer stopped being obvious the moment an AI
 * Teammate could run the same operations a person runs. Every knowledge write
 * used to stamp `human:<userId>` from the context, which was true when only a
 * person could reach the operation. With a granted Teammate on the other end
 * of the call, `ctx.userId` is the colleague who *asked*, not the author, and
 * stamping them would put a person's name on content a model wrote.
 *
 * So the rule is: the actor is whoever produced the content. A Teammate signs
 * as an agent. Who asked is recorded by the transcript, which is the audit
 * (#767, story 17), and by whatever `created_by` column the row already has.
 *
 * This is the same rule that keeps `verified` honest at accept time (the
 * ADR-0017 amendment): a machine never signs as a person. `generated` matters
 * less than `verified`, because only `verified` moves the trust tier, but a
 * false authorship record is still a false record.
 */
export function writingActor(ctx: OperationContext): string {
  if (ctx.teammate) return okfActor.agent("teammate", ctx.teammate.name);
  return okfActor.human(ctx.userId || "api-key");
}
