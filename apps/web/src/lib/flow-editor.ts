import type {
  Flow,
  FlowAction,
  FlowActionSettings,
  FlowCondition,
  FlowConditionLogic,
  FlowTrigger,
  FlowTriggerSettings,
  HttpFlowMethod,
} from "@agent-hub/core";
import {
  DEFAULT_DWELL_SECONDS,
  connectorSettingsIssue,
  DEFAULT_HTTP_FLOW_METHODS,
  httpFlowMethods,
  isHttpTrigger,
  httpWebhookSettingsIssue,
  humanReviewSettingsIssue,
  respondSettingsIssue,
  isProactiveTrigger,
} from "@agent-hub/core";

import {
  FLOW_ACTIONS,
  actionsFitTrigger,
  partitionActionsForTrigger,
} from "@/lib/flow-actions";
import {
  cleanFlowConditions,
  flowConditionDescription,
  flowConditionsSavable,
} from "@/lib/flow-conditions";

/**
 * The Flow Builder's editing engine: every rule about what a flow draft may
 * save, what a trigger change discards, and what payload a save sends. The
 * FlowBuilder component is a rendering adapter over this module; the rules
 * live here so they are testable through plain vitest (`.tsx` tests are not
 * picked up in this app) and stay in one place.
 */

export interface FlowDwell {
  minutes: number;
  seconds: number;
}

/** Everything the builder edits, the draft the status rules judge. */
export interface FlowDraft {
  name: string;
  trigger: FlowTrigger | null;
  dwell: FlowDwell;
  /**
   * "On HTTP request": the methods the Flow's endpoint answers (#843). Beside
   * `dwell` rather than inside a generic settings blob, for the same reason
   * `dwell` is: it belongs to one trigger, and the editor edits it as a field.
   */
  httpMethods: HttpFlowMethod[];
  conditionLogic: FlowConditionLogic;
  conditions: FlowCondition[];
  actions: FlowAction[];
  settings: FlowActionSettings;
  customMessage: string;
}

/**
 * The draft a stored Flow opens as, or the empty draft for a new one. Both
 * renderings of the builder start from this, so they start from the same place.
 */
export function draftFromFlow(flow: Flow | null): FlowDraft {
  return {
    name: flow?.name ?? "",
    trigger: flow ? flow.trigger : null,
    dwell: initialDwell(flow?.triggerSettings),
    httpMethods: flow ? httpFlowMethods(flow) : DEFAULT_HTTP_FLOW_METHODS,
    conditionLogic: flow?.conditionLogic ?? "any",
    conditions: flow?.conditions ?? [],
    actions: flow?.actions ?? [],
    settings: flow?.actionSettings ?? {},
    customMessage: flow?.customMessage ?? "",
  };
}

/**
 * Whether a Flow on this trigger has a Conditions step at all.
 *
 * Only a message-triggered Flow does. A proactive Flow fires on a widget event
 * (#541) and an inbound Flow is named by its URL (#843): in neither case does a
 * classifier pick the Flow, so there is nothing for a condition to narrow, and
 * the runtime (`packages/core/src/http-flow.ts`, the proactive funnel) never
 * evaluates one. The canvas, the palette, the trigger switch and the save
 * payload all ask this one function, so they cannot disagree about it.
 */
export function triggerHasConditions(trigger: FlowTrigger | null): boolean {
  return trigger === null || !(isProactiveTrigger(trigger) || isHttpTrigger(trigger));
}

/**
 * Time-on-page dwell for the editor: the stored minutes+seconds, or the
 * default when the flow has none (or stores an all-zero dwell).
 */
export function initialDwell(
  triggerSettings: FlowTriggerSettings | undefined
): FlowDwell {
  const stored = triggerSettings?.timeOnPage;
  const total =
    (stored?.minutes ?? 0) * 60 + (stored?.seconds ?? 0) || DEFAULT_DWELL_SECONDS;
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/**
 * Per-action "is it configured enough to save?", the required settings each
 * Flow Action must carry before the editor may offer to persist it.
 */
export function actionConfigured(
  action: FlowAction,
  settings: FlowActionSettings,
  customMessage: string
): boolean {
  if (action === "notification")
    return Boolean(settings.notification?.content?.trim());
  if (action === "custom_message") return customMessage.trim().length > 0;
  if (action === "show_button") {
    const button = settings.show_button;
    if (button?.type === "help_desk") return Boolean(button.helpDeskId);
    if (button?.type === "send_text") return Boolean(button.text?.trim());
    if (button?.type === "faq") return Boolean(button.faqQuestion?.trim());
    return Boolean(button?.url?.trim());
  }
  if (action === "iframe") return Boolean(settings.iframe?.url?.trim());
  if (action === "api_request") {
    const api = settings.api_request;
    // A Swagger-sourced step names an operation instead of a URL (#837).
    return api?.endpoint === "swagger"
      ? Boolean(api.swaggerUrl?.trim() && api.operationId?.trim())
      : Boolean(api?.url?.trim());
  }
  // Same rules the runtime applies (#842, #843), so a step that reads
  // "configured" here is one the dispatcher will actually run.
  if (action === "http_webhook") {
    return httpWebhookSettingsIssue(settings.http_webhook) === null;
  }
  if (action === "respond") return respondSettingsIssue(settings.respond) === null;
  if (action === "send_email") return Boolean(settings.send_email?.to?.trim());
  if (action === "handover") return Boolean(settings.handover?.assistantId);
  // The catalogue decides (#839): a catalogued action, a connection, and its
  // required fields. The connection's health is Publish's question, not the
  // editor's, a saved Flow may outlive the connection it names.
  if (action === "connector") return connectorSettingsIssue(settings.connector) === null;
  // Same rule Publish applies (#841), minus roster and sender health.
  if (action === "human_review") return humanReviewSettingsIssue(settings.human_review) === null;
  if (action === "follow_up_questions") {
    const followUp = settings.follow_up_questions;
    if (followUp?.mode !== "manual") return true;
    return (followUp.questions ?? []).some((q) => q.trim().length > 0);
  }
  return true;
}

export interface FlowDraftStatus {
  dwellOk: boolean;
  triggerOk: boolean;
  /** A proactive trigger collapses Conditions and the Response step (#541). */
  proactive: boolean;
  /**
   * An inbound-HTTP trigger (#843). Like a proactive one it has no conditions,
   * because the caller named the Flow by its URL rather than being routed to
   * it, but unlike one it has a whole catalogue of actions.
   */
  inbound: boolean;
  configuredActions: boolean;
  actionsMatchTrigger: boolean;
  responseOk: boolean;
  nameOk: boolean;
  conditionsOk: boolean;
  canSave: boolean;
  /** Why the save button is disabled, null when it isn't. */
  disabledHint: string | null;
}

/**
 * Judges a draft: which gates pass, whether it may save, and the one reason
 * shown when it may not. Gate order in the hint mirrors the builder's steps
 * (trigger → response → conditions → name).
 */
export function flowDraftStatus(
  draft: FlowDraft,
  options: { isDefaultFlow: boolean; isEdit: boolean }
): FlowDraftStatus {
  const { trigger, dwell, actions, settings, customMessage, conditions, name } =
    draft;
  const saveLabel = options.isEdit ? "Save changes" : "Create flow";

  const dwellSeconds = dwell.minutes * 60 + dwell.seconds;
  // A zero dwell would make "Time on page" indistinguishable from "On page
  // load", which is a trigger the admin could have picked instead.
  const dwellOk = trigger !== "time_on_page" || dwellSeconds > 0;
  const triggerOk = options.isDefaultFlow || (trigger !== null && dwellOk);
  const proactive = trigger !== null && isProactiveTrigger(trigger);
  const inbound = trigger !== null && isHttpTrigger(trigger);
  const configuredActions = actions.every((action) =>
    actionConfigured(action, settings, customMessage)
  );
  // Belt to the braces in triggerChangePlan: the runtime refuses an action its
  // trigger may not run, so the editor must never offer to save that pair, a
  // refused save has to be a disabled button with a reason, never a 500.
  const actionsMatchTrigger = actionsFitTrigger(actions, trigger);
  const responseOk = actions.length > 0 && configuredActions && actionsMatchTrigger;
  const nameOk = name.trim().length > 0;
  // An incomplete objective condition would reach the runtime as a condition
  // the gate has to ignore, refuse it here instead (spec #550).
  const conditionsOk = flowConditionsSavable(conditions);
  const canSave = triggerOk && responseOk && nameOk && conditionsOk;

  const disabledHint = !dwellOk
    ? "Set how long the user must stay on the page"
    : !triggerOk
      ? `Set a trigger to enable ${saveLabel}`
      : actions.length === 0
        ? `Add a response action to enable ${saveLabel}`
        : !actionsMatchTrigger
          ? `Remove the actions this trigger cannot run: ${partitionActionsForTrigger(
              actions,
              trigger ?? "message"
            )
              .discarded.map((action) => FLOW_ACTIONS[action].label)
              .join(", ")}`
          : !configuredActions
            ? "Complete the required settings for every response action"
            : !conditionsOk
              ? "Complete every condition you added"
              : !nameOk
                ? `Name the flow to enable ${saveLabel}`
                : null;

  return {
    dwellOk,
    triggerOk,
    proactive,
    inbound,
    configuredActions,
    actionsMatchTrigger,
    responseOk,
    nameOk,
    conditionsOk,
    canSave,
    disabledHint,
  };
}

export interface TriggerChangePlan {
  /** True when applying would discard work, so the admin must confirm first. */
  needsConfirmation: boolean;
  /** Actions the new trigger can still run. */
  kept: FlowAction[];
  /** Actions the new trigger cannot run, what the confirmation names. */
  discarded: FlowAction[];
  /** Crossing into a proactive or an inbound trigger drops the conditions. */
  clearsConditions: boolean;
}

/**
 * Plans a trigger change. The question is asked of the *actions*, not of the
 * previous trigger: "Remove trigger" nulls the trigger while leaving the
 * actions in place, so comparing trigger kinds saw no crossing and cleared
 * nothing, the editor then offered to save `custom_message` on `chat_open`,
 * a pair the server action refuses.
 */
export function triggerChangePlan(
  draft: Pick<FlowDraft, "actions" | "conditions">,
  next: FlowTrigger
): TriggerChangePlan {
  const { kept, discarded } = partitionActionsForTrigger(draft.actions, next);
  const clearsConditions = !triggerHasConditions(next) && draft.conditions.length > 0;
  return {
    needsConfirmation: discarded.length > 0 || clearsConditions,
    kept,
    discarded,
    clearsConditions,
  };
}

/**
 * Applies a (confirmed) trigger change: keeps whatever the new trigger can
 * still run, drops only what it cannot, and clears the state the new trigger
 * has no step for: the conditions (proactive and inbound triggers have no
 * Conditions step), the custom message (neither can run Message), and
 * orphaned notification settings.
 */
export function applyTriggerChange(draft: FlowDraft, next: FlowTrigger): FlowDraft {
  const { kept } = partitionActionsForTrigger(draft.actions, next);
  const dropsMessage = isProactiveTrigger(next) || isHttpTrigger(next);
  const settings = kept.includes("notification")
    ? draft.settings
    : { ...draft.settings, notification: undefined };
  return {
    ...draft,
    trigger: next,
    actions: kept,
    conditions: triggerHasConditions(next) ? draft.conditions : [],
    customMessage: dropsMessage ? "" : draft.customMessage,
    settings,
  };
}

/** What createFlowAction / updateFlowAction persist (minus the name). */
export interface FlowSavePayload {
  description: string;
  trigger: FlowTrigger;
  triggerSettings: FlowTriggerSettings;
  conditionLogic: FlowConditionLogic;
  conditions: FlowCondition[];
  actions: FlowAction[];
  actionSettings: FlowActionSettings;
  customMessage: string;
}

/**
 * Builds the save payload from a draft: conditions are cleaned, the flow
 * description is regenerated from them (the classifier catalogs flows by
 * description, keep it in sync with the builder's semantic conditions), a
 * trigger with no Conditions step saves none (a stale list on an inbound Flow
 * would be stored and never evaluated), and only Time-on-page stores a dwell,
 * every other trigger stores its own settings or an empty object rather than
 * a stale dwell from a previous choice.
 */
export function flowSavePayload(
  draft: FlowDraft,
  existing: Pick<Flow, "description"> | null
): FlowSavePayload {
  const cleanedConditions = triggerHasConditions(draft.trigger)
    ? cleanFlowConditions(draft.conditions)
    : [];
  const joined = flowConditionDescription(cleanedConditions);
  return {
    description: joined || existing?.description || "",
    trigger: draft.trigger ?? "message",
    triggerSettings:
      draft.trigger === "time_on_page"
        ? {
            timeOnPage: {
              minutes: draft.dwell.minutes,
              seconds: draft.dwell.seconds,
            },
          }
        : draft.trigger === "http_request"
          ? { httpRequest: { methods: draft.httpMethods } }
          : {},
    conditionLogic: draft.conditionLogic,
    conditions: cleanedConditions,
    actions: draft.actions,
    actionSettings: draft.settings,
    customMessage: draft.customMessage,
  };
}
