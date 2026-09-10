import type {
  Flow,
  FlowAction,
  FlowActionSettings,
  FlowCondition,
  FlowConditionLogic,
  FlowInput,
  FlowPatch,
  FlowTrigger,
} from "@agent-hub/core";
import type { RuntimeEvent } from "@agent-hub/agent/client";
import {
  CONNECTOR_PROVIDER_LABELS,
  connectorAction,
  httpFlowMethods,
  isHttpTrigger,
  isProactiveTrigger,
  withReviewBeforeConnectorWrites,
} from "@agent-hub/core";
import type { FlowDraft } from "@/lib/flow-editor";
import { flowSavePayload, initialDwell } from "@/lib/flow-editor";
import { FLOW_ACTIONS, FLOW_TRIGGER_LABELS } from "@/lib/flow-actions";
import { flowConditionDescription } from "@/lib/flow-conditions";

/**
 * The Flows Agent's two seams with the canvas (#838), as pure functions so the
 * route and the panel are adapters and this file is where the behaviour is
 * tested.
 *
 * Outbound: {@link flowsAgentGrounding} renders what the agent must know before
 * it drafts, the open draft and the Assistant's catalogue, as standing-context
 * sections the turn injects above the transcript. Inbound:
 * {@link flowsAgentPayload} reads a `flows.draft` / `flows.propose` hand-back
 * off the tool-end event, and {@link draftPatchFromAgent} turns the patch into
 * the same `Partial<FlowDraft>` a manual edit produces, so it enters the Undo
 * history like one.
 */

/** The tool names the model sees, derived the way the runtime derives them. */
export const FLOWS_DRAFT_TOOL = "flows_draft";
export const FLOWS_PROPOSE_TOOL = "flows_propose";

export interface FlowsAgentCatalogue {
  assistant: { id: string; title: string };
  /** The open Flow's id, null on the new-Flow canvas. */
  flowId: string | null;
  draft: FlowDraft;
  /** The Assistant's other Flows (the open one is described by the draft). */
  flows: readonly Pick<Flow, "id" | "name" | "description" | "trigger" | "actions" | "enabled" | "isDefault" | "builtIn">[];
  helpDesks: readonly { id: string; name: string }[];
  faqs: readonly { id: string; question: string }[];
  connections: readonly { id: string; provider: string; name: string; status: string }[];
  /** The Knowledge Collections Search knowledge retrieves from. */
  collections: readonly { id: string; name: string }[];
  assistants: readonly { id: string; title: string }[];
}

const MAX_LIST = 40;

function clip<T>(items: readonly T[]): readonly T[] {
  return items.length > MAX_LIST ? items.slice(0, MAX_LIST) : items;
}

function describeActions(actions: readonly FlowAction[]): string {
  return actions.length
    ? actions.map((action) => `${action} (${FLOW_ACTIONS[action].label})`).join(" → ")
    : "none";
}

/** The standing-context sections one turn gets. Order is reading order. */
export function flowsAgentGrounding(catalogue: FlowsAgentCatalogue): string[] {
  const { draft, flowId } = catalogue;
  const payload = flowSavePayload(draft, null);
  const openFlow = [
    `# The open flow${flowId ? ` (id ${flowId})` : " (new, not yet saved)"}`,
    `Assistant: ${catalogue.assistant.title} (id ${catalogue.assistant.id}).`,
    `Name: ${draft.name.trim() || "(unnamed)"}`,
    `Trigger: ${draft.trigger ? `${draft.trigger} (${FLOW_TRIGGER_LABELS[draft.trigger]})` : "none chosen yet"}`,
    draft.trigger === "time_on_page"
      ? `Dwell: ${draft.dwell.minutes}m ${draft.dwell.seconds}s`
      : null,
    draft.trigger && isProactiveTrigger(draft.trigger)
      ? "Proactive trigger: no conditions, and the only action it can run is `notification`."
      : draft.trigger && isHttpTrigger(draft.trigger)
        ? `Inbound HTTP trigger: no conditions (the caller names this flow by its URL). Methods: ${draft.httpMethods.join(", ")}.`
        : `Conditions (${draft.conditionLogic}): ${flowConditionDescription(draft.conditions) || "none"}`,
    `Actions: ${describeActions(draft.actions)}`,
    draft.customMessage.trim() ? `Message text: ${draft.customMessage.trim()}` : null,
    `Action settings (JSON): ${JSON.stringify(payload.actionSettings)}`,
    "",
    "Change this flow only with the flows_draft tool. Pass only the fields you change, and pass currentTrigger when you change actions without changing the trigger. Valid action names: " +
      (Object.keys(FLOW_ACTIONS) as FlowAction[]).join(", ") +
      ". Valid triggers: " +
      (Object.keys(FLOW_TRIGGER_LABELS) as FlowTrigger[]).join(", ") +
      ".",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const others = clip(catalogue.flows.filter((flow) => flow.id !== flowId));
  const flows = [
    "# The assistant's other flows",
    others.length === 0
      ? "None."
      : others
          .map(
            (flow) =>
              `- ${flow.name}${flow.isDefault ? " [default]" : flow.builtIn ? " [built-in]" : ""}${flow.enabled ? "" : " [disabled]"}: trigger ${flow.trigger}; actions ${describeActions(flow.actions)}${flow.description ? `; ${flow.description}` : ""}`
          )
          .join("\n"),
    "Do not draft an intent one of these already routes; say which flow covers it instead. Use flows_propose for a second intent that deserves its own flow.",
    "When you add a Connector action that writes to the external system, put a human_review action before it: the canvas inserts one if you do not, and the editor decides whether to remove it.",
  ].join("\n");

  const catalogueText = [
    "# What this assistant can use",
    `Knowledge collections Search knowledge answers from: ${
      clip(catalogue.collections).map((collection) => collection.name).join(", ") || "none"
    }`,
    `Help desks a Button of type help desk may open: ${
      clip(catalogue.helpDesks).map((desk) => `${desk.name} (id ${desk.id})`).join(", ") || "none"
    }`,
    `FAQs a Button of type FAQ may show: ${
      clip(catalogue.faqs).map((faq) => `"${faq.question}" (id ${faq.id})`).join(", ") || "none"
    }`,
    `Application connections a Connector action may use: ${
      clip(catalogue.connections)
        .map(
          (connection) =>
            `${connection.name} [${CONNECTOR_PROVIDER_LABELS[connection.provider as keyof typeof CONNECTOR_PROVIDER_LABELS] ?? connection.provider}, id ${connection.id}, ${connection.status}]`
        )
        .join(", ") || "none; the editor connects one under Knowledge → Applications"
    }`,
    `Other assistants a Handover may target: ${
      clip(catalogue.assistants).map((a) => `${a.title} (id ${a.id})`).join(", ") || "none"
    }`,
  ].join("\n");

  return [openFlow, flows, catalogueText];
}

/** A `flows.draft` hand-back as the tool-end event carries it. */
export interface FlowsAgentDraftPayload {
  kind: "draft";
  summary: string;
  patch: FlowPatch;
}

/** A `flows.propose` hand-back. */
export interface FlowsAgentProposalPayload {
  kind: "proposal";
  rationale: string;
  flow: FlowInput;
}

export type FlowsAgentPayload = FlowsAgentDraftPayload | FlowsAgentProposalPayload;

/**
 * What one runtime event hands the canvas, or null for every other event. Only
 * a successful tool-end of one of the two tools qualifies: a refused call (the
 * pairing rule, a bad action name) has `ok: false` and no payload, and the
 * model reads the refusal and tries again.
 */
export function flowsAgentPayload(event: RuntimeEvent): FlowsAgentPayload | null {
  if (event.type !== "tool-end" || !event.ok) return null;
  const payload = (event.result as { payload?: Record<string, unknown> } | undefined)?.payload;
  if (!payload || typeof payload !== "object") return null;
  if (event.tool === FLOWS_DRAFT_TOOL && payload.applied === "draft" && payload.patch) {
    return {
      kind: "draft",
      summary: String(payload.summary ?? ""),
      patch: payload.patch as FlowPatch,
    };
  }
  if (event.tool === FLOWS_PROPOSE_TOOL && payload.proposal) {
    return {
      kind: "proposal",
      rationale: String(payload.rationale ?? ""),
      flow: payload.proposal as FlowInput,
    };
  }
  return null;
}

/**
 * A validated patch as the draft edit it stands for. Field for field the
 * inverse of `flowSavePayload`, so what the agent drafts and what Save would
 * send are the same shape; `description` has no draft field (it is derived
 * from the conditions on save) and is dropped. `triggerSettings` unpacks into
 * both trigger-scoped draft fields, the dwell and the HTTP methods, through the
 * same readers `draftFromFlow` uses on a stored Flow.
 */
export function draftPatchFromAgent(patch: FlowPatch): Partial<FlowDraft> {
  const next: Partial<FlowDraft> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.trigger !== undefined) next.trigger = patch.trigger;
  if (patch.triggerSettings !== undefined) {
    next.dwell = initialDwell(patch.triggerSettings);
    next.httpMethods = httpFlowMethods({ triggerSettings: patch.triggerSettings });
  }
  if (patch.conditionLogic !== undefined) {
    next.conditionLogic = patch.conditionLogic as FlowConditionLogic;
  }
  if (patch.conditions !== undefined) next.conditions = patch.conditions as FlowCondition[];
  if (patch.actions !== undefined) next.actions = patch.actions;
  if (patch.actionSettings !== undefined) {
    next.settings = patch.actionSettings as FlowActionSettings;
  }
  if (patch.customMessage !== undefined) next.customMessage = patch.customMessage;
  return next;
}

/**
 * The safe shape is the default (#841, story 58): when the agent adds a
 * Connector **write** to a chain that has no Human review before it, one is
 * inserted in front of it, unconfigured (so it shows "Needs setup" until the
 * Editor names the reviewers). Removing the gate is then a deliberate act.
 * Reads pass through untouched.
 */
export function ensureReviewBeforeConnectorWrites(
  patch: FlowPatch,
  current: Pick<FlowDraft, "actions" | "settings">
): FlowPatch {
  // A patch that only re-points the Connector at a write (settings, no
  // actions) still turns the chain into one that writes.
  const touchesConnector =
    patch.actions !== undefined || patch.actionSettings?.connector !== undefined;
  if (!touchesConnector) return patch;
  const settings = patch.actionSettings?.connector ?? current.settings.connector;
  if (connectorAction(settings?.action)?.effect !== "write") return patch;
  const actions = [...(patch.actions ?? current.actions)];
  return {
    ...patch,
    actions: withReviewBeforeConnectorWrites(actions, { connector: settings }),
  };
}

/**
 * The model's patch touches only the fields it names, but its action settings
 * arrive whole for the actions it names and silent on the rest: a patch that
 * adds a Connector must not erase the API request's settings beside it. Merge
 * per action, and drop settings for actions no longer in the chain only when
 * the patch also rewrote the chain.
 */
export function mergeAgentSettings(
  current: FlowActionSettings,
  patch: FlowPatch
): FlowActionSettings | undefined {
  if (patch.actionSettings === undefined) return undefined;
  const merged: FlowActionSettings = { ...current };
  for (const [action, settings] of Object.entries(patch.actionSettings)) {
    const key = action as keyof FlowActionSettings;
    merged[key] = {
      ...(current[key] as object | undefined),
      ...(settings as object),
    } as never;
  }
  if (patch.actions !== undefined) {
    for (const key of Object.keys(merged) as (keyof FlowActionSettings)[]) {
      if (!patch.actions.includes(key as FlowAction)) delete merged[key];
    }
  }
  return merged;
}
