import type { Assistant, Flow, Source } from "@agent-hub/core";
import { redactFlowSecrets } from "@agent-hub/core";

/**
 * API resource projections (#620): what /api/v1 serves is a deliberate
 * subset of the row, the editable, client-safe fields. Internal wiring
 * (tools config, style internals, model routing) stays out until a slice
 * decides to expose it on purpose.
 */
export function assistantResource(a: Assistant) {
  return {
    id: a.id,
    title: a.title,
    nickname: a.nickname,
    description: a.description,
    avatarUrl: a.avatarUrl,
    welcomeMessage: a.welcomeMessage,
    aiDisclaimer: a.aiDisclaimer,
    suggestedQuestions: a.suggestedQuestions,
    answeringStyle: a.answeringStyle,
    chatLauncherEnabled: a.chatLauncherEnabled,
    allowedDomains: a.allowedDomains,
    requireSignIn: a.requireSignIn,
    createdAt: a.createdAt,
  };
}

/** A Source's client-safe view, enough to poll `status` until it settles. */
export function sourceResource(s: Source) {
  return {
    id: s.id,
    collectionId: s.collectionId,
    name: s.name,
    kind: s.kind,
    status: s.status,
    createdAt: s.createdAt,
  };
}

/**
 * Flows serve their router config, minus the `api_request` credentials in it:
 * that is what the API exists to edit, and a token is not part of it. The ops
 * layer already redacts, so this is the second of two independent projections,
 * because this function is the documented boundary for what /api/v1 emits.
 */
export function flowResource(flow: Flow) {
  const f = redactFlowSecrets(flow);
  return {
    id: f.id,
    assistantId: f.assistantId,
    name: f.name,
    description: f.description,
    builtIn: f.builtIn,
    isDefault: f.isDefault,
    enabled: f.enabled,
    position: f.position,
    trigger: f.trigger,
    triggerSettings: f.triggerSettings,
    conditionLogic: f.conditionLogic,
    conditions: f.conditions,
    actions: f.actions,
    actionSettings: f.actionSettings,
    customMessage: f.customMessage,
  };
}
