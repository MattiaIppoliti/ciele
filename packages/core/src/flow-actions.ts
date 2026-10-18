import type { Flow, FlowActionStep } from "./types";

type ActionFlow = Pick<Flow, "actions" | "actionSettings" | "customMessage">;

/** Materializes legacy settings without changing the stored Flow. Actions stay authoritative. */
export function flowActionSteps(flow: ActionFlow): FlowActionStep[] {
  const { steps, ...legacySettings } = flow.actionSettings;
  return flow.actions.map((action, index) => {
    const step = steps?.[index];
    if (step?.action === action) return step;
    return {
      id: flow.actions.indexOf(action) === index ? `action:${action}` : `action:${action}:${index}`,
      action,
      settings: legacySettings,
      customMessage: flow.customMessage,
    };
  });
}

/** Projects one occurrence's settings while retaining the complete ordered Flow. */
export function flowForActionStep(flow: Flow, index: number): Flow {
  if (!flow.actionSettings.steps) return flow;
  const step = flowActionSteps(flow)[index];
  if (!step) return flow;
  return {
    ...flow,
    actionSettings: { ...step.settings, steps: flow.actionSettings.steps },
    customMessage: step.customMessage ?? "",
  };
}
