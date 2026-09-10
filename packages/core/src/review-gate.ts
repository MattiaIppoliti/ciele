import { connectorAction } from "./connector-catalog";
import type { FlowAction, FlowActionSettings } from "./types";

/**
 * Human review before a Connector write (#841).
 *
 * The Flows Agent drafts Flows, and a Flow that writes into another system
 * through a Connector is one a person should approve before it runs. The
 * ticket asks for that as a default the agent applies. A sentence in the
 * agent's persona is not a default: a model can be talked out of prose. This
 * is the rule as a function, applied to every draft and proposal the agent
 * hands back, so the gate is there whatever the model was asked.
 *
 * A read action needs no gate. A Connector whose action is not yet chosen is
 * treated as a write, because the catalogue says write actions default to
 * review and an unchosen one may become either.
 */
export function withReviewBeforeConnectorWrites(
  actions: readonly FlowAction[],
  settings: FlowActionSettings | undefined
): FlowAction[] {
  const index = actions.indexOf("connector");
  if (index < 0) return [...actions];
  if (actions.slice(0, index).includes("human_review")) return [...actions];
  const action = connectorAction(settings?.connector?.action);
  if (action?.effect === "read") return [...actions];
  // One Human review per Flow: a Flow that already has the gate after the
  // write moves it before, rather than gaining a second.
  const without = actions.filter((entry) => entry !== "human_review");
  const at = without.indexOf("connector");
  return [...without.slice(0, at), "human_review", ...without.slice(at)];
}
