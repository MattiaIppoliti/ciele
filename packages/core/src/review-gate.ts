import { connectorAction } from "./connector-catalog";
import { flowActionSteps } from "./flow-actions";
import type { FlowAction, FlowActionSettings, FlowActionStep } from "./types";

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
  return withReviewBeforeConnectorWriteSteps(actions, settings).actions;
}

/** Keeps independently configured instances aligned when an agent adds the gate. */
export function withReviewBeforeConnectorWriteSteps(
  actions: readonly FlowAction[],
  settings: FlowActionSettings | undefined
): { actions: FlowAction[]; actionSettings: FlowActionSettings | undefined } {
  const steps = flowActionSteps({ actions: [...actions], actionSettings: settings ?? {}, customMessage: "" });
  const index = steps.findIndex((step) =>
    step.action === "connector" && connectorAction(step.settings.connector?.action)?.effect !== "read"
  );
  if (index < 0 || steps.slice(0, index).some((step) => step.action === "human_review")) {
    return { actions: [...actions], actionSettings: settings };
  }
  const existing = steps.find((step) => step.action === "human_review");
  let id = "action:human_review";
  for (let suffix = 1; !existing && steps.some((step) => step.id === id); suffix += 1) {
    id = `action:human_review:${suffix}`;
  }
  const gate: FlowActionStep = existing ?? { id, action: "human_review", settings: settings?.human_review ? { human_review: settings.human_review } : {} };
  // Move one existing gate, preserving its configuration and any other copied gates.
  const reordered = steps.filter((step) => step !== existing);
  reordered.splice(index, 0, gate);
  return {
    actions: reordered.map((step) => step.action),
    actionSettings: settings?.steps ? { ...settings, steps: reordered } : settings,
  };
}
