import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import type {
  ApiIntegration,
  Assistant,
  Flow,
  FlowAction,
  FlowRoutingContext,
  Provider,
  ProviderConnection,
  SkillSnapshot,
  TrustTier,
} from "@agent-hub/core";
import { matchFlow, messageFlowCandidates } from "@agent-hub/core";
import { z } from "zod";

import type { ChatReplyPart } from "./types";
import type { TurnSession } from "./session";
import {
  getClassifierModel,
  resolveChatModel,
  type KeyResolution,
  type ProviderCredential,
} from "./models";
import { PROVIDER_NAMES } from "./catalog";
import { ACTION_HANDLERS, contactLabel } from "./actions";
import { needsWatchEscalation } from "./trust";
import { buildHelpDeskRecommender } from "./help-desk-recommend";
import type { EscalationDeskCandidate } from "./help-desk-recommend";
import { withWorkflowName } from "./template";
import type {
  ActionContext,
  ActionEffect,
  HistoryMessage,
  KnowledgeDocument,
  KnowledgeSearcher,
  RunResult,
  RuntimeEvent,
  UsageEvent,
} from "./types";
import { usageTotals } from "./usage";
import { errorMessageOf } from "./telemetry";

// Re-exported so callers keep importing the runtime contract from one place.
export type {
  ActionEffect,
  HistoryMessage,
  KnowledgeSearcher,
  RunResult,
  RuntimeEvent,
} from "./types";

export interface ProviderHealthEvent {
  provider: Provider;
  credentialKind: ProviderCredential["kind"];
  ok: boolean;
  detail?: string;
}

/**
 * Intent Classification (see context.md): routes the message to the
 * highest-priority matching enabled flow with a cheap LLM call; falls back to
 * the deterministic keyword matcher when no model is configured or on error.
 */

/**
 * Renders one flow as a catalog entry for the classifier prompt: trigger
 * description plus builder conditions with their should/should-not examples.
 * (Exported for tests — the routing chain is pinned in engine.test.ts.)
 */
export function flowCatalogEntry(flow: Flow): string {
  const lines = [
    `- id: ${flow.id} — name: ${flow.name} — triggers when: ${flow.description}`,
  ];
  // Only semantic conditions belong in a prompt. URL and Schedule are objective
  // facts, already gated in `messageFlowCandidates` before this flow became a
  // candidate; showing them here would be noise at best and misleading steering
  // at worst (spec #550).
  const conditions = (flow.conditions ?? []).filter(
    (condition) => condition.kind === "conversation_context"
  );
  if (conditions.length > 0) {
    const logic =
      (flow.conditionLogic ?? "any") === "all"
        ? "ALL conditions must match"
        : "ANY condition may match";
    lines.push(`  Conditions (${logic}):`);
    for (const condition of conditions) {
      lines.push(`  • ${condition.description}`);
      for (const example of condition.examples) {
        if (!example.message.trim()) continue;
        const tag = example.shouldTrigger ? "matches" : "does NOT match";
        const note = example.note.trim() ? ` (${example.note.trim()})` : "";
        lines.push(`    - "${example.message}" ${tag}${note}`);
      }
    }
  }
  return lines.join("\n");
}

export async function classifyIntent(
  message: string,
  flows: Flow[],
  classifier: LanguageModel | null,
  assistantName?: string,
  /** Raw SDK usage of the classify call, for the AI usage ledger. */
  onUsage?: (usage: unknown) => void,
  /** Page URL + clock for the objective condition gate (spec #550). */
  routing: FlowRoutingContext = {}
): Promise<Flow | null> {
  // Flows fired by page/chat events never compete for user messages, and
  // neither do flows whose URL/Schedule conditions cannot pass.
  const candidates = messageFlowCandidates(flows, routing);
  const defaultFlow = flows.find((f) => f.isDefault && f.enabled) ?? null;
  if (candidates.length === 0 || !classifier) {
    return matchFlow(message, flows, routing);
  }

  try {
    const { object, usage } = await generateObject({
      model: classifier,
      schema: z.object({
        matchingFlowIds: z
          .array(z.string())
          .describe(
            "Every flow id whose trigger and conditions clearly match the message"
          ),
      }),
      system: [
        'You are an intent router for a support chatbot. Given a user message and a priority-ordered list of flows (id + trigger description, some with conditions and example messages), return EVERY flow whose trigger conditions clearly match. Use the examples to calibrate: messages like the "matches" examples should match the flow, messages like the "does NOT match" examples should not.',
        // Flows capture intent toward the assistant/support process; factual
        // questions must reach the knowledge base (Default behavior), or FAQs
        // and documents become unreachable behind canned flow replies.
        'Flows describe the user\'s intent toward the assistant or the support process (e.g. asking what the assistant can do, asking to reach a human). A request for FACTS or information — about a person, product, organization, deadline, policy, or any content topic — must go to "default": the default behavior searches the knowledge base (FAQs, documents, websites) and is the only path that can answer it. This applies even when the question shares words or names with a flow description.',
        assistantName
          ? `The assistant itself is named "${assistantName}". Only questions about the assistant's own identity, capabilities or purpose concern the assistant; questions about people or things with the same or a similar name are content questions and go to "default".`
          : null,
        "The list is ordered from highest to lowest priority. Return all clear matches; the router will deterministically select the highest-priority one. When in doubt, or when no trigger clearly applies, return an empty list so Default behavior can answer from the knowledge base.",
      ]
        .filter(Boolean)
        .join(" "),
      prompt: `User message: """${message}"""\n\nFlows:\n${candidates
        .map(flowCatalogEntry)
        .join("\n")}`,
    });
    onUsage?.(usage);
    const matchingIds = new Set(object.matchingFlowIds.map((id) => id.trim()));
    const picked = candidates.find((flow) => matchingIds.has(flow.id));
    return picked ?? defaultFlow;
  } catch {
    return matchFlow(message, flows, routing);
  }
}

/**
 * The one Flow-action dispatch loop, shared by the no-model and model paths of
 * `runAssistantChat`: executes the routed flow's actions in order through the
 * ACTION_HANDLERS registry, accumulating parts/effects, merging each action's
 * templatePatch into the context, capturing handover, and honoring halt.
 * The paths differ only in the context they build and in how a failed action
 * is turned into a fallback part (`onActionError`; return null to stop
 * dispatching, e.g. after an abort). Mutates `parts`/`effects` in place —
 * `ctx.priorParts` aliases `parts` so handlers see earlier output.
 */
async function dispatchActions(options: {
  ctx: ActionContext;
  parts: ChatReplyPart[];
  effects: ActionEffect[];
  signal?: AbortSignal;
  onActionError: (
    action: FlowAction,
    error: unknown
  ) => Promise<ChatReplyPart | null> | ChatReplyPart | null;
}): Promise<{ handoverTo: string | null }> {
  const { ctx, parts, effects, signal, onActionError } = options;
  let handoverTo: string | null = null;
  // Built-in catch-alls (Default behavior, Assistant Information, …) ship with
  // no actions. Rather than dead-end on the "no actions configured" fallback,
  // an unconfigured built-in flow generatively answers from the assistant's
  // knowledge — the expected out-of-the-box behavior (search_knowledge is
  // generative; see context.md). An admin's own empty flow still surfaces the
  // misconfiguration hint below.
  const actions =
    ctx.flow.builtIn && ctx.flow.actions.length === 0
      ? (["search_knowledge"] as FlowAction[])
      : ctx.flow.actions;
  for (const action of actions) {
    if (signal?.aborted) break;
    const handler = ACTION_HANDLERS[action];
    if (!handler) continue;
    try {
      const result = await handler(ctx);
      parts.push(...result.parts);
      if (result.effects) effects.push(...result.effects);
      if (result.templatePatch)
        ctx.templateContext = { ...ctx.templateContext, ...result.templatePatch };
      if (result.handoverTo) handoverTo = result.handoverTo;
      if (result.halt) break;
    } catch (error) {
      const part = await onActionError(action, error);
      if (!part) break;
      ctx.emit({ type: "part", part });
      parts.push(part);
    }
  }
  if (parts.length === 0 && effects.length === 0) {
    const part: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: `The flow "${ctx.flow.name}" matched, but it has no actions configured yet.`,
    };
    ctx.emit({ type: "part", part });
    parts.push(part);
  }
  return { handoverTo };
}

/**
 * Runs already-selected proactive flows (#541): a client event fired, the
 * trigger picked the flows, and each one's actions execute in order.
 *
 * Deliberately *not* `dispatchActions`: a proactive flow has no message to
 * answer, so neither of that loop's message-turn courtesies applies — an
 * unconfigured flow must stay silent rather than emit "this flow has no actions
 * configured", and an empty built-in must not fall back to generative search. No
 * model is resolved here at all, which is what makes a proactive turn free.
 *
 * The caller is responsible for having filtered the flows through
 * `proactiveFlowCandidates` and the delivery rule; this function trusts that
 * decision and only executes.
 */
export async function runProactiveFlows(options: {
  assistant: Assistant;
  platformPrompt?: string;
  /** Flows to run, in order — already selected and cleared for delivery. */
  flows: Flow[];
  templateContext?: ActionContext["templateContext"];
  session: TurnSession;
  skills?: SkillSnapshot[];
  emit: (e: RuntimeEvent) => void;
  signal?: AbortSignal;
  keyResolution?: KeyResolution;
}): Promise<{
  parts: ChatReplyPart[];
  effects: ActionEffect[];
  /** The first flow that produced output — the message's flow marker. */
  flowId: string | null;
  flowName: string;
}> {
  const {
    assistant,
    platformPrompt = "",
    flows,
    templateContext,
    session,
    skills = [],
    emit,
    signal,
    keyResolution = {},
  } = options;

  const parts: ChatReplyPart[] = [];
  const effects: ActionEffect[] = [];
  const delivered: Flow[] = [];

  // Same wire ordering as a message turn: the flow marker precedes its parts.
  const leading = flows[0];
  if (leading) {
    emit({
      type: "flow",
      flowId: leading.id,
      flowName: leading.name,
      isDefault: false,
    });
  }

  for (const flow of flows) {
    if (signal?.aborted) break;
    const before = parts.length;
    const ctx: ActionContext = {
      assistant,
      platformPrompt,
      flow,
      // A proactive turn has no Visitor message and no history to ground in:
      // the nudge is verbatim, so neither is needed.
      message: "",
      history: [],
      templateContext: withWorkflowName(templateContext, flow.name),
      chatModel: null,
      session,
      skills,
      priorParts: parts,
      emit,
      signal,
      previewSurface: keyResolution.surface === "preview",
    };
    for (const action of flow.actions) {
      if (signal?.aborted) break;
      const handler = ACTION_HANDLERS[action];
      if (!handler) continue;
      try {
        const result = await handler(ctx);
        parts.push(...result.parts);
        if (result.effects) effects.push(...result.effects);
        if (result.halt) break;
      } catch (error) {
        // One broken nudge must not suppress the others, and a Visitor is never
        // shown an apology for a message they did not ask for.
        console.error(
          `[runtime] proactive action ${action} failed on flow ${flow.id}:`,
          errorMessageOf(error)
        );
      }
    }
    if (parts.length > before) delivered.push(flow);
  }

  const first = delivered[0] ?? null;
  return {
    parts,
    effects,
    flowId: first?.id ?? null,
    flowName: delivered.map((f) => f.name).join(" + "),
  };
}

/**
 * Authoritative flow router + agent-in-the-actions (context.md runtime
 * invariants): the matched flow's actions execute in order via the
 * ACTION_HANDLERS registry (see actions.ts); custom_message is verbatim; only
 * search_knowledge / Default behavior are generative. Returns the reply parts
 * plus any deferred effects for the caller to apply after persistence.
 */
export async function runAssistantChat(options: {
  assistant: Assistant;
  /** The immutable platform (Ciele) prompt layer; "" falls back sanely. */
  platformPrompt?: string;
  flows: Flow[];
  connections: ProviderConnection[];
  message: string;
  history: HistoryMessage[];
  /** Resolved template-variable catalog interpolated into action text this turn. */
  templateContext?: ActionContext["templateContext"];
  /**
   * Page URL + clock the objective Flow Conditions (URL, Schedule) are gated
   * against (spec #550). Omitted leaves them unevaluatable, which never
   * disqualifies a Flow — an unwired caller keeps the previous behaviour.
   */
  routing?: FlowRoutingContext;
  searchKnowledge?: KnowledgeSearcher;
  /**
   * Reads one knowledge document whole, for the windowed `readKnowledgeSource`
   * tool (spec #559). Absent leaves that tool unregistered — an unwired caller
   * keeps exactly the previous behaviour.
   */
  readKnowledgeDocument?: (id: string) => Promise<KnowledgeDocument | null>;
  /**
   * The Assistant's API catalogue integration, credential still sealed (spec
   * #559). Absent or with an empty catalogue leaves the three catalogue tools
   * unregistered.
   */
  apiIntegration?: ApiIntegration | null;
  /**
   * Active Knowledge Collection anchor (see the #53 audit). Scopes retrieval
   * upstream and seeds the Agentic Search context frame; null/absent degrades
   * to assistant-wide.
   */
  collectionId?: string | null;
  /** Persistent cross-turn session state (see session.ts). */
  session: TurnSession;
  /**
   * Whether an earlier turn in this conversation already asked the Visitor to
   * clarify (#558 anti-loop guarantee). Derived by the caller from the persisted
   * parts; false/absent for a fresh conversation.
   */
  alreadyClarified?: boolean;
  /** Skills attached to the assistant (live rows or a Publication snapshot). */
  skills?: SkillSnapshot[];
  /**
   * The desks this assistant may recommend ("AI recommended help desk"):
   * id + name + description candidates resolved by the Conversation Turn.
   * Absent/empty → escalation chips stay generic.
   */
  escalationDesks?: EscalationDeskCandidate[];
  emit: (e: RuntimeEvent) => void;
  signal?: AbortSignal;
  /** ADR-0001 surface context; omit for published traffic (safe default). */
  keyResolution?: KeyResolution;
  onProviderHealth?: (event: ProviderHealthEvent) => void | Promise<void>;
  /**
   * Live trust-tier lookup for the routed flow (flow trust ledger). Read at
   * turn time — never snapshotted into Publications — and fail-open: null
   * (missing row or error) behaves like `queue`, changing nothing.
   */
  getFlowTrust?: (flowId: string) => Promise<TrustTier | null>;
}): Promise<RunResult> {
  const {
    assistant,
    platformPrompt = "",
    flows,
    connections,
    message,
    history,
    templateContext,
    routing = {},
    searchKnowledge,
    readKnowledgeDocument,
    apiIntegration,
    collectionId = null,
    session,
    alreadyClarified = false,
    skills = [],
    escalationDesks = [],
    emit,
    signal,
    keyResolution = {},
    onProviderHealth,
  } = options;

  // Cross-provider fallback: a missing credential for the assistant's
  // configured provider answers with another credentialed provider instead of
  // dropping to the keyword engine (which would silently skip every
  // system-prompt layer).
  const resolved = resolveChatModel(
    assistant.modelProvider,
    assistant.modelId,
    connections,
    keyResolution
  );
  const classifier = getClassifierModel(
    assistant.modelProvider,
    connections,
    keyResolution
  );
  const chatModel = resolved?.model ?? null;
  const healthTrackedCredential =
    resolved?.credentialKind === "google_vertex_federated" ? resolved : null;
  let providerFailed = false;
  // AI usage ledger: one event per model call this turn, persisted post-commit
  // by the Conversation Turn.
  const usageEvents: UsageEvent[] = [];

  // "AI recommended help desk": one lazy, cached recommendation per turn,
  // shared by every escalation-chip emission site through the action context.
  const recommendHelpDesk = buildHelpDeskRecommender({
    assistant,
    desks: escalationDesks,
    model: classifier?.model ?? null,
    message,
    history,
    signal,
    recordUsage: (usage) => {
      if (!classifier) return;
      usageEvents.push({
        stage: "classify",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    },
  });

  if (resolved?.usedFallback) {
    emit({
      type: "notice",
      label: `No ${PROVIDER_NAMES[assistant.modelProvider]} credential configured — answering with ${PROVIDER_NAMES[resolved.provider]} (${resolved.modelId}) instead`,
    });
  }

  // No LLM configured anywhere → deterministic demo engine (ADR-0003), same
  // wire events. search_knowledge still runs a real (lexical) search.
  if (!chatModel) {
    emit({
      type: "notice",
      label:
        "No AI provider credential configured for this organization — using keyword matching (add a provider connection in Settings → AI)",
    });
    const flow = matchFlow(message, flows, routing);
    if (!flow) {
      const part: ChatReplyPart = {
        type: "text",
        action: "fallback",
        text: "No enabled flow can handle this message — enable the Default behavior flow or add a new one.",
      };
      emit({ type: "flow", flowId: null, flowName: "No flow", isDefault: true });
      emit({ type: "part", part });
      return {
        parts: [part],
        effects: [],
        flowId: null,
        flowName: "No flow",
        usage: [],
      };
    }
    emit({ type: "notice", label: `Matched flow “${flow.name}” (keyword matching)` });
    emit({
      type: "flow",
      flowId: flow.id,
      flowName: flow.name,
      isDefault: flow.isDefault,
    });
    const parts: ChatReplyPart[] = [];
    const effects: ActionEffect[] = [];
    const ctx: ActionContext = {
      assistant,
      platformPrompt,
      flow,
      message,
      history,
      collectionId,
      templateContext: withWorkflowName(templateContext, flow.name),
      chatModel: null,
      searchKnowledge,
      session,
      skills,
      priorParts: parts,
      emit,
      signal,
      previewSurface: keyResolution.surface === "preview",
      recommendHelpDesk,
    };

    const { handoverTo } = await dispatchActions({
      ctx,
      parts,
      effects,
      signal,
      onActionError: (action) => ({
        type: "text",
        action: "fallback",
        text: `The "${action}" step could not be completed. Please try again.`,
      }),
    });
    return {
      parts,
      effects,
      flowId: flow.id,
      flowName: flow.name,
      usage: [],
      handoverTo,
    };
  }

  const flow = await classifyIntent(
    message,
    flows,
    classifier?.model ?? null,
    assistant.nickname || assistant.title,
    (usage) => {
      if (!classifier) return;
      usageEvents.push({
        stage: "classify",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
        ...usageTotals(usage),
      });
    },
    routing
  );

  if (!flow) {
    const part: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: "No enabled flow can handle this message — enable the Default behavior flow or add a new one.",
    };
    emit({ type: "flow", flowId: null, flowName: "No flow", isDefault: true });
    emit({ type: "part", part });
    return {
      parts: [part],
      effects: [],
      flowId: null,
      flowName: "No flow",
      usage: usageEvents,
    };
  }

  // The routing decision, stated once the classifier has made it — the emitter
  // knows which flow matched, so the trace row carries it directly instead of a
  // later event patching an earlier row (#560).
  emit({ type: "notice", label: "Classifying intent", detail: `Matched flow “${flow.name}”` });
  emit({
    type: "flow",
    flowId: flow.id,
    flowName: flow.name,
    isDefault: flow.isDefault,
  });

  // Kicked off in parallel with the actions; consulted after they finish.
  const trustTierPromise: Promise<TrustTier | null> = options.getFlowTrust
    ? options.getFlowTrust(flow.id).catch(() => null)
    : Promise.resolve(null);

  const parts: ChatReplyPart[] = [];
  const effects: ActionEffect[] = [];
  const ctx: ActionContext = {
    assistant,
    platformPrompt,
    flow,
    message,
    history,
    collectionId,
    templateContext: withWorkflowName(templateContext, flow.name),
    chatModel,
    searchKnowledge,
    readKnowledgeDocument,
    apiIntegration,
    session,
    alreadyClarified,
    skills,
    priorParts: parts,
    emit,
    signal,
    previewSurface: keyResolution.surface === "preview",
    recommendHelpDesk,
    // Pre-bound with the turn's resolved chat model so handlers only report
    // token totals; `resolved` is non-null whenever a handler runs.
    recordUsage: (usage) => {
      if (!resolved) return;
      usageEvents.push({
        stage: "generate",
        provider: resolved.provider,
        modelId: resolved.modelId,
        credentialKind: resolved.credentialKind,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    },
  };

  const { handoverTo } = await dispatchActions({
    ctx,
    parts,
    effects,
    signal,
    onActionError: async (action, error) => {
      if (signal?.aborted) return null;
      const providerBacked =
        action === "search_knowledge" || action === "follow_up_questions";
      if (providerBacked) providerFailed = true;
      if (providerBacked && healthTrackedCredential && onProviderHealth) {
        await onProviderHealth({
          provider: healthTrackedCredential.provider,
          credentialKind: healthTrackedCredential.credentialKind,
          ok: false,
          detail: errorMessageOf(error),
        });
      }
      // Provider errors (quota, model ids, key hints) are admin diagnostics:
      // show them in Preview, never to widget visitors.
      const diagnostic = keyResolution.surface === "preview";
      return {
        type: "text",
        action: "fallback",
        text: diagnostic
          ? `The "${action}" step failed (${errorMessageOf(error)}). Check the provider configuration in Settings → AI.`
          : "Sorry — I ran into a problem answering that. Please try again in a moment.",
      };
    },
  });

  if (healthTrackedCredential && !providerFailed && onProviderHealth) {
    await onProviderHealth({
      provider: healthTrackedCredential.provider,
      credentialKind: healthTrackedCredential.credentialKind,
      ok: true,
    });
  }

  // Watch-tier flows always offer the human exit ramp with their generative
  // answers (flow trust ledger — the one behavioral consequence in v1).
  if (needsWatchEscalation(parts, await trustTierPromise)) {
    const recommended = await recommendHelpDesk();
    const part: ChatReplyPart = {
      type: "help_desk",
      action: "suggest_help_desk",
      label: contactLabel(assistant),
      ...(recommended ? { helpDeskId: recommended } : {}),
    };
    emit({ type: "part", part });
    parts.push(part);
  }

  return {
    parts,
    effects,
    flowId: flow.id,
    flowName: flow.name,
    usage: usageEvents,
    handoverTo,
  };
}
