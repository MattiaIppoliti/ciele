import { flowActionSteps, type FlowAction, type FlowActionStep, type FlowActionStepSettings } from "@agent-hub/core";
import type { FlowDraft } from "./flow-editor";

/** Legacy flows acquire occurrence IDs only when an edit needs independent copies. */
export function draftActionSteps(draft: Pick<FlowDraft, "actions" | "settings" | "customMessage">): FlowActionStep[] {
  return flowActionSteps({ actions: draft.actions, actionSettings: draft.settings, customMessage: draft.customMessage });
}

function hasSettings(action: FlowAction): action is keyof FlowActionStepSettings {
  return action !== "custom_message" && action !== "improvement" && action !== "suggest_help_desk";
}

/** Keep the legacy fields useful to callers that read the first action of a type. */
function withSteps(draft: FlowDraft, steps: FlowActionStep[]): FlowDraft {
  let settings = { ...draft.settings, steps };
  const seen = new Set<FlowAction>();
  for (const step of steps) {
    if (seen.has(step.action)) continue;
    seen.add(step.action);
    if (hasSettings(step.action)) settings = { ...settings, [step.action]: step.settings[step.action] };
  }
  return {
    ...draft,
    actions: steps.map((step) => step.action),
    settings,
    customMessage: steps.find((step) => step.action === "custom_message")?.customMessage ?? draft.customMessage,
  };
}

/** Deep copy the complete configuration, including nested headers, buttons and inputs. */
export function duplicateActionStep(draft: FlowDraft, id: string, copyId: string): FlowDraft {
  if (draft.actions.length >= 20) return draft;
  const steps = draftActionSteps(draft);
  const index = steps.findIndex((step) => step.id === id);
  const source = steps[index];
  if (!source || steps.some((step) => step.id === copyId)) return draft;
  const copy = { ...structuredClone(source), id: copyId, copiedFromId: source.copiedFromId ?? source.id };
  return withSteps(draft, [...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)]);
}

/** Move one occurrence, leaving its equally typed neighbours intact. */
export function moveActionStep(draft: FlowDraft, id: string, to: number): FlowDraft {
  const steps = draftActionSteps(draft);
  const step = steps.find((candidate) => candidate.id === id);
  if (!step) return draft;
  const remaining = steps.filter((candidate) => candidate.id !== id);
  const at = Math.max(0, Math.min(to, remaining.length));
  const ordered = [...remaining.slice(0, at), step, ...remaining.slice(at)];
  return draft.settings.steps ? withSteps(draft, ordered) : { ...draft, actions: ordered.map((item) => item.action) };
}

export function removeActionStep(draft: FlowDraft, id: string): FlowDraft {
  const remaining = draftActionSteps(draft).filter((step) => step.id !== id);
  return draft.settings.steps ? withSteps(draft, remaining) : { ...draft, actions: remaining.map((step) => step.action) };
}

/** Catalogue and agent edits preserve existing occurrences in their new order. */
export function replaceDraftActions(draft: FlowDraft, actions: FlowAction[]): FlowDraft {
  if (!draft.settings.steps) return { ...draft, actions };
  const remaining = [...draftActionSteps(draft)];
  const used = new Set(remaining.map((step) => step.id));
  const steps = actions.map((action, index) => {
    const existing = remaining.findIndex((step) => step.action === action);
    if (existing !== -1) return remaining.splice(existing, 1)[0]!;
    let id = `action:${action}`;
    for (let suffix = index; used.has(id); suffix += 1) id = `action:${action}:${suffix}`;
    used.add(id);
    return { id, action, settings: hasSettings(action) ? { [action]: draft.settings[action] } : {}, customMessage: draft.customMessage };
  });
  return withSteps(draft, steps);
}

export function insertDraftAction(draft: FlowDraft, action: FlowAction, index = draft.actions.length): FlowDraft {
  if (draft.actions.includes(action)) return draft;
  const at = Math.max(0, Math.min(index, draft.actions.length));
  return replaceDraftActions(draft, [...draft.actions.slice(0, at), action, ...draft.actions.slice(at)]);
}

export function patchDraftActionSettings<K extends keyof FlowActionStepSettings>(
  draft: FlowDraft, key: K, patch: NonNullable<FlowActionStepSettings[K]>, id?: string
): FlowDraft {
  if (!draft.settings.steps) return { ...draft, settings: { ...draft.settings, [key]: { ...draft.settings[key], ...patch } } };
  const target = id ?? draftActionSteps(draft).find((step) => step.action === key)?.id;
  return withSteps(draft, draftActionSteps(draft).map((step) => step.id === target
    ? { ...step, settings: { ...step.settings, [key]: { ...step.settings[key], ...patch } } }
    : step));
}

export function patchDraftCustomMessage(draft: FlowDraft, message: string, id?: string): FlowDraft {
  if (!draft.settings.steps) return { ...draft, customMessage: message };
  const target = id ?? draftActionSteps(draft).find((step) => step.action === "custom_message")?.id;
  return withSteps(draft, draftActionSteps(draft).map((step) => step.id === target ? { ...step, customMessage: message } : step));
}
