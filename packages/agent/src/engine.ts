import { streamObject } from "ai";
import type { LanguageModel } from "ai";
import type {
  ApiIntegration,
  Assistant,
  EntitySnapshot,
  Flow,
  FlowAction,
  FlowRoutingContext,
  PreflightCatalogue,
  PreflightTraceRecord,
  Provider,
  ProviderConnection,
  ReferralCandidate,
  SkillSnapshot,
  TrustTier,
} from "@agent-hub/core";
import {
  basicInteractionFlow,
  studyModeFlow,
  studyRequestFormat,
  STUDY_MODE_FLOW_ID,
  matchFlow,
  messageFlowCandidates,
  spokenLanguage,
  thinkingLine,
  thinkingOutcome,
} from "@agent-hub/core";
import { z } from "zod";
import { getRuntimeHost } from "./host";
import { runApprovalGate } from "./approval-gate";
import { decide, resolveDecisionModel } from "./decision-model";
import { decidedRoute, runPreflight, type PreflightFaqAnswer, type PreflightOutcome } from "./preflight-shadow";
import type { ChatReplyPart } from "./types";
import type { UntrustedEnvelope } from "./untrusted-content";
import type { TurnSession } from "./session";
import {
  getClassifierModel,
  isOperatorSurface,
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
  TeammateActionTool,
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
 * (Exported for tests, the routing chain is pinned in engine.test.ts.)
 */
export function flowCatalogEntry(flow: Flow): string {
  const lines = [
    `- id: ${flow.id}, name: ${flow.name}, triggers when: ${flow.description}`,
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
  routing: FlowRoutingContext = {},
  /**
   * Streams the router's own one-line reading of the message as a thought, so
   * the Thinking panel is not blank while this call runs. Absent, nothing is
   * emitted and the call behaves exactly as it did.
   */
  emit?: (event: RuntimeEvent) => void
): Promise<Flow | null> {
  // Flows fired by page/chat events never compete for user messages, and
  // neither do flows whose URL/Schedule conditions cannot pass.
  const candidates = messageFlowCandidates(flows, routing);
  const defaultFlow = flows.find((f) => f.isDefault && f.enabled) ?? null;
  if (candidates.length === 0 || !classifier) {
    return matchFlow(message, flows, routing);
  }

  // `streamObject` settles its object promise in only one of the two ways a
  // provider fails. A `doStream` that throws (connection refused, 4xx before
  // any byte) rejects it, since `ai` 7.0.70. A stream that opens and then
  // carries an `error` part (the provider died mid-answer) does **not**: the
  // promise stays pending forever and only `onError` fires, checked against
  // 7.0.107. Routing must never wait on that, so the failure is turned back
  // into a rejection here and raced against the answer, which is what the
  // keyword-matcher fallback below depends on.
  let reportStreamFailure: (error: unknown) => void = () => {};
  const streamFailed = new Promise<never>((_, reject) => {
    reportStreamFailure = reject;
  });
  // Attached before anything can reject it.
  streamFailed.catch(() => {});

  try {
    const { partialObjectStream, object: objectPromise, usage: usagePromise } =
      streamObject({
      model: classifier,
      onError: ({ error }) => reportStreamFailure(error),
      schema: z.object({
        // First in the schema, so it is generated first and can stream while
        // the ids are still being decided. Routing used to be the one part of
        // a turn with nothing to show: the panel sat on "Thinking…" with no
        // step under it until the first tool call.
        intent: z
          .string()
          .describe(
            "One short sentence, in the user's own language, saying what THIS PERSON is asking for. Describe the request, never the routing: do not name, quote or allude to any flow, id, trigger or condition, and do not say which one you picked. Write it as something the person could read about themselves."
          ),
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
        'Flows describe the user\'s intent toward the assistant or the support process (e.g. asking what the assistant can do, asking to reach a human). A request for FACTS or information, about a person, product, organization, deadline, policy, or any content topic, must go to "default": the default behavior searches the knowledge base (FAQs, documents, websites) and is the only path that can answer it. This applies even when the question shares words or names with a flow description.',
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
    // Deltas rather than one settled thought, so this reads like the rest of
    // the panel: `foldTraceEvent` grows the running step in place.
    //
    // Narration is deliberately not what routing waits on: iterating a stream
    // that never opens simply hangs, and one that dies mid-answer ends without
    // settling the object. So the decision awaits the race above, which rejects
    // into the keyword-matcher fallback below, and the deltas ride alongside
    // where they cannot stall a turn.
    const narrate = (async () => {
      let streamed = "";
      for await (const partial of partialObjectStream) {
        const intent = typeof partial.intent === "string" ? partial.intent : "";
        if (emit && intent.length > streamed.length) {
          emit({ type: "thought-delta", delta: intent.slice(streamed.length) });
          streamed = intent;
        }
      }
    })();
    // Attached now, so a failed stream is never an unhandled rejection even
    // when the object promise rejects first and this is never awaited.
    narrate.catch(() => {});

    const object = await Promise.race([objectPromise, streamFailed]);
    // Every delta is out before the terminal thought settles the step.
    await narrate.catch(() => {});
    if (emit) {
      // The prompt forbids naming a flow; this is what enforces it. Flows are
      // deliberately invisible to chat users, and the router is the one call
      // whose input is the whole catalogue, so a model that echoes a name back
      // would put an organization's routing on a stranger's screen. The
      // terminal event rewrites the streamed label in place (`foldThought`),
      // so a leaked name survives only the moment before it lands.
      const settled = routingNarration(object.intent, candidates);
      if (settled) emit({ type: "thought", text: settled });
    }
    onUsage?.(await Promise.race([usagePromise, streamFailed]));
    const matchingIds = new Set(object.matchingFlowIds.map((id) => id.trim()));
    const picked = candidates.find((flow) => matchingIds.has(flow.id));
    return picked ?? defaultFlow;
  } catch {
    return matchFlow(message, flows, routing);
  }
}

/**
 * The router's narration, or null when it named something it must not.
 *
 * Exported for its test: the check is a one-line rule with a consequence worth
 * asserting rather than trusting to a prompt.
 */
export function routingNarration(
  intent: string,
  candidates: readonly Flow[]
): string | null {
  const text = intent.trim();
  if (!text) return null;
  const haystack = text.toLowerCase();
  const named = candidates.some((flow) => {
    const name = flow.name.trim().toLowerCase();
    return (
      haystack.includes(flow.id.toLowerCase()) ||
      (name.length > 2 && haystack.includes(name))
    );
  });
  return named ? null : text;
}

/**
 * The Flow a routing pre-flight hands the turn (#953), or null for "today's
 * path". Only the two outcomes that name a Flow route here: a listed Flow the
 * decision cleared, or knowledge search, which is the Default behavior Flow.
 * The id is checked against the live, enabled list rather than trusted from
 * the record, so a Flow disabled between the catalogue read and now falls to
 * classification instead of running. An FAQ or an escalation outcome is not a
 * Flow and is left to today's path (#954, #955 take them from here).
 */
export function preflightRoutedFlow(outcome: PreflightOutcome, flows: readonly Flow[]): Flow | null {
  const route = decidedRoute(outcome);
  if (!route) return null;
  if (route.kind === "flow") {
    return flows.find((f) => f.id === route.flowId && f.enabled && f.trigger === "message") ?? null;
  }
  if (route.kind === "knowledge_search") {
    return flows.find((f) => f.isDefault && f.enabled) ?? null;
  }
  return null;
}

/**
 * The one Flow-action dispatch loop, shared by the no-model and model paths of
 * `runAssistantChat`: executes the routed flow's actions in order through the
 * ACTION_HANDLERS registry, accumulating parts/effects, merging each action's
 * templatePatch into the context, capturing handover, and honoring halt.
 * The paths differ only in the context they build and in how a failed action
 * is turned into a fallback part (`onActionError`; return null to stop
 * dispatching, e.g. after an abort). Mutates `parts`/`effects` in place,
 * `ctx.priorParts` aliases `parts` so handlers see earlier output.
 */
async function dispatchActions(options: {
  ctx: ActionContext;
  parts: ChatReplyPart[];
  effects: ActionEffect[];
  signal?: AbortSignal;
  /**
   * First action to run (#841): a resumed Conversation continues after the
   * Human review gate rather than replaying what already ran. Default 0.
   */
  startIndex?: number;
  onActionError: (
    action: FlowAction,
    error: unknown
  ) => Promise<ChatReplyPart | null> | ChatReplyPart | null;
}): Promise<{ handoverTo: string | null }> {
  const { ctx, parts, effects, signal, onActionError } = options;
  const startIndex = options.startIndex ?? 0;
  let handoverTo: string | null = null;
  const effectKeyPrefix = ctx.idempotencyKey;
  // Built-in catch-alls (Default behavior, Assistant Information, …) ship with
  // no actions. Rather than dead-end on the "no actions configured" fallback,
  // an unconfigured built-in flow generatively answers from the assistant's
  // knowledge, the expected out-of-the-box behavior (search_knowledge is
  // generative; see context.md). An admin's own empty flow still surfaces the
  // misconfiguration hint below.
  const actions =
    ctx.flow.builtIn && ctx.flow.actions.length === 0
      ? (["search_knowledge"] as FlowAction[])
      : ctx.flow.actions;
  for (const [actionIndex, action] of actions.entries()) {
    if (actionIndex < startIndex) continue;
    if (signal?.aborted) break;
    ctx.actionIndex = actionIndex;
    ctx.idempotencyKey = effectKeyPrefix
      ? `${effectKeyPrefix}/action-${actionIndex}`
      : undefined;
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
      action: startIndex > 0 ? "human_review" : "fallback",
      text:
        startIndex > 0
          ? // A resumed Flow whose remaining actions produced no reply: the
            // Visitor still needs to hear the gate opened.
            "Your request was approved."
          : `The flow "${ctx.flow.name}" matched, but it has no actions configured yet.`,
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
 * answer, so neither of that loop's message-turn courtesies applies, an
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
  /** Flows to run, in order, already selected and cleared for delivery. */
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
  /** The first flow that produced output, the message's flow marker. */
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
      previewSurface: isOperatorSurface(keyResolution),
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
  /**
   * The persona layer of an AI Teammate turn (#768): who this agent is and
   * what its Standing Role says, replacing the "you are a website assistant"
   * identity lines. Absent on Assistant turns.
   */
  persona?: string;
  flows: Flow[];
  connections: ProviderConnection[];
  message: string;
  history: HistoryMessage[];
  /** Resolved template-variable catalog interpolated into action text this turn. */
  templateContext?: ActionContext["templateContext"];
  /**
   * Page URL + clock the objective Flow Conditions (URL, Schedule) are gated
   * against (spec #550). Omitted leaves them unevaluatable, which never
   * disqualifies a Flow, an unwired caller keeps the previous behaviour.
   */
  routing?: FlowRoutingContext;
  searchKnowledge?: KnowledgeSearcher;
  /**
   * Reads one knowledge document whole, for the windowed `readKnowledgeSource`
   * tool (spec #559). Absent leaves that tool unregistered, an unwired caller
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
   * An AI Teammate's granted actions (#770), already filtered by the host
   * against its grant rows and its ceiling. Empty registers no action tools.
   */
  teammateActions?: readonly TeammateActionTool[];
  /** Its three memory documents, rendered (#771). Empty injects nothing. */
  memoryDocuments?: readonly string[];
  /**
   * This turn carries a file. It suppresses the courtesy short-circuit below:
   * `memoryDocuments` cannot stand in for this, because a Teammate turn always
   * has memory layers and would then never recognise a greeting again.
   */
  hasAttachments?: boolean;
  /** Third-party text for this turn (#857), fenced as untrusted by the search action. */
  untrustedContext?: readonly UntrustedEnvelope[];
  /** Colleagues this Teammate may refer to (#773); empty registers no tool. */
  referralCandidates?: readonly ReferralCandidate[];
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
  /** Long-term memories recalled for the turn's SSO subject (#664). */
  longTermMemory?: string[];
  /**
   * Mid-conversation long-term memory recall (#664); presence registers the
   * `searchMemories` tool. Provided by the Conversation Turn under its gate
   * (org toggle on + verified SSO subject).
   */
  searchMemories?: ActionContext["searchMemories"];
  /** Selected shared Entities (#665): snapshot on the widget, live in Preview. */
  entities?: EntitySnapshot[];
  /** Live Record read for the auto-generated Entity tools (#665). */
  queryEntityRecords?: ActionContext["queryEntityRecords"];
  /** The Connector action's host port (#839), bound over the turn's Db. */
  connectorRuntime?: ActionContext["connectorRuntime"];
  /** The Human review gate's host port (#841), bound over the turn's Conversation. */
  reviewRuntime?: ActionContext["reviewRuntime"];
  /** Counts non-model operations the Flow performs (#854); priced at zero. */
  countOperation?: ActionContext["countOperation"];
  /** The callback gate's host port (#842), bound over the turn's Conversation. */
  webhookRuntime?: ActionContext["webhookRuntime"];
  /** Who the turn verifiably speaks for, Entity tool policy input (#667). */
  toolSubject?: ActionContext["toolSubject"];
  /**
   * The desks this assistant may recommend ("AI recommended help desk"):
   * id + name + description candidates resolved by the Conversation Turn.
   * Absent/empty → escalation chips stay generic.
   */
  escalationDesks?: EscalationDeskCandidate[];
  /**
   * The database half of the shadow pre-flight's catalogue (#952): the FAQs and
   * the help desks. A loader rather than the values because it costs reads the
   * great majority of turns must not pay, the flag is off, or the message is
   * courtesy, or a gate already picked the Flow; the engine calls it only when
   * it is about to ask. The Flow half is not here on purpose: which Flows are
   * candidates is what the URL and Schedule gates decide, and only the engine
   * knows that.
   */
  loadPreflightCatalogue?: () => Promise<Pick<PreflightCatalogue, "faqs" | "desks">>;
  /**
   * The Visitor's browser locale, the fallback for the pre-flight's fixed
   * Thinking line when the decision could not tell which language the message
   * was written in (#953). Null or absent falls back to English.
   */
  visitorLocale?: string | null;
  /**
   * A curated FAQ's stored answer by id, for the FAQ direct hit (#954). Null
   * for an FAQ that is gone or excluded, which sends the turn down today's
   * path. Absent, the pre-flight never answers with an FAQ.
   */
  readPreflightFaq?: (faqId: string) => Promise<PreflightFaqAnswer | null>;
  emit: (e: RuntimeEvent) => void;
  signal?: AbortSignal;
  /** ADR-0001 surface context; omit for published traffic (safe default). */
  keyResolution?: KeyResolution;
  onProviderHealth?: (event: ProviderHealthEvent) => void | Promise<void>;
  /**
   * Live trust-tier lookup for the routed flow (flow trust ledger). Read at
   * turn time, never snapshotted into Publications, and fail-open: null
   * (missing row or error) behaves like `queue`, changing nothing.
   */
  getFlowTrust?: (flowId: string) => Promise<TrustTier | null>;
  /** Stable prefix rooted in the durable Conversation Turn claim. */
  effectKeyPrefix?: string;
  /**
   * Continue a Flow after one of its gates (#841 Human review, #842 the
   * callback gate): no classification, the named Flow, dispatch from the
   * action after the gate, with the gate's outcome in the template context. A
   * system-initiated turn: `message` is empty and nothing is persisted as the
   * Visitor's words.
   *
   * `action` names the gate being resumed, and is checked against the live
   * Flow below. Two gates share this seam rather than each adding a branch.
   */
  resumeFrom?: {
    flowId: string;
    actionIndex: number;
    action: FlowAction;
    templatePatch: Record<string, string>;
  };
}): Promise<RunResult> {
  const {
    assistant,
    platformPrompt = "",
    persona,
    flows: configuredFlows,
    connections,
    message,
    history,
    templateContext,
    routing = {},
    searchKnowledge,
    readKnowledgeDocument,
    apiIntegration,
    teammateActions,
    memoryDocuments,
    untrustedContext,
    referralCandidates,
    collectionId = null,
    session,
    alreadyClarified = false,
    skills = [],
    longTermMemory,
    searchMemories,
    entities = [],
    queryEntityRecords,
    connectorRuntime,
    reviewRuntime,
    countOperation,
    webhookRuntime,
    toolSubject,
    escalationDesks = [],
    loadPreflightCatalogue,
    visitorLocale = null,
    readPreflightFaq,
    emit,
    signal,
    keyResolution = {},
    resumeFrom,
    onProviderHealth,
    effectKeyPrefix,
  } = options;
  const studyFlow = persona ? null : studyModeFlow(assistant);
  const flows = studyFlow ? [studyFlow, ...configuredFlows] : configuredFlows;
  const requestedStudyFlow = studyRequestFormat(message) ? studyFlow : null;
  const storedFlowId = (flow: Flow) => flow.id === STUDY_MODE_FLOW_ID ? null : flow.id;
  // A resumed Conversation (#841, #842) names its Flow and the index of its
  // gate. A Flow deleted, disabled or re-arranged between the gate and its
  // outcome resumes nothing: the cursor is an index, and an index into a chain
  // that changed would run the wrong action, or the gate itself again. The
  // action name is what makes that check possible.
  const resumedFlow = resumeFrom
    ? (flows.find(
        (candidate) =>
          candidate.id === resumeFrom.flowId &&
          candidate.enabled &&
          candidate.actions[resumeFrom.actionIndex] === resumeFrom.action
      ) ?? null)
    : null;
  if (resumeFrom && !resumedFlow) {
    const part: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: "This flow changed while I was waiting, so I can't continue with it.",
    };
    emit({ type: "flow", flowId: null, flowName: "No flow", isDefault: true });
    emit({ type: "part", part });
    return { parts: [part], effects: [], flowId: null, flowName: "No flow", usage: [] };
  }
  const resumeIndex = resumeFrom ? resumeFrom.actionIndex + 1 : 0;
  const resumeContext = (base: ActionContext["templateContext"]) =>
    resumeFrom ? { ...(base ?? {}), ...resumeFrom.templatePatch } : base;


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

  /**
   * The approval gate (#958) as the actions see it. One closure over the
   * turn's connections, resolved lazily so a Flow with no gated step pays
   * nothing; a failure answers "ask a human", never "go ahead".
   */
  const judgeAction: ActionContext["judgeAction"] = async (subject) => {
    const gate = await runApprovalGate({
      subject,
      resolved: resolveDecisionModel(assistant.modelProvider, connections, keyResolution),
      signal,
      recordUsage: (event) => {
        usageEvents.push(event);
      },
    });
    // No backend configured is no gate at all; a backend that answered, or
    // that failed while configured, is a verdict. See the port's contract.
    return gate.backend === null ? null : gate.verdict;
  };

  // Never rejects: a pre-flight that could fail a turn would be worse than no
  // pre-flight. `runPreflight` already swallows the decision's own failures;
  // this catches the catalogue read.
  const flowCandidates = messageFlowCandidates(flows, routing);
  async function startPreflight(): Promise<PreflightOutcome | null> {
    if (!loadPreflightCatalogue) return null;
    try {
      const sources = await loadPreflightCatalogue();
      return await runPreflight({
        message,
        // The same gated, priority-ordered candidates Intent Classification
        // itself asks about, so the two decisions see one list.
        catalogue: { ...sources, flows: flowCandidates },
        resolved: resolveDecisionModel(assistant.modelProvider, connections, keyResolution),
        // An FAQ catalogue over the option cap is shortlisted by similarity to
        // the message (#954): the same search the Default behavior runs, read
        // for its Concept ids only.
        rankFaqs: searchKnowledge
          ? async () =>
              (await searchKnowledge(message, { scope: "assistant" })).map((result) => result.conceptId)
          : undefined,
        signal,
        recordUsage: (usage) => {
          usageEvents.push(usage);
        },
      });
    } catch {
      return null;
    }
  }

  // Basic Interaction (#566): courtesy is recognised deterministically, before
  // anything is spent. Deliberately ABOVE the chat-model branch, both engines
  // consult one decision from one call site, so they cannot drift. A hit skips
  // Intent Classification entirely and emits no notices, which is what leaves
  // the turn with a null trace and the Visitor with no Thinking panel.
  // A message that came with a file is not courtesy, whatever its words are:
  // somebody who attaches an invoice and types "hi there" is asking about the
  // invoice, and the courtesy path answers without ever reading it.
  const courtesyFlow = options.hasAttachments
    ? null
    : basicInteractionFlow(message, flows, {
        ...routing,
        history,
      });

  // Above the courtesy check would put one notice on a turn that must have none,
  // and which provider answered a greeting is not worth a Thinking panel. The
  // fallback is still recorded where it matters: the usage ledger names the
  // provider that actually ran.
  //
  // Preview only: naming the missing credential and the substitute model is an
  // operator diagnostic addressed to an admin configuring the Assistant. A
  // Visitor in an embedded widget must never see which provider keys the
  // organization does or does not hold (same rule as the provider-error text
  // below).
  if (
    resolved?.usedFallback &&
    !courtesyFlow &&
    isOperatorSurface(keyResolution)
  ) {
    emit({
      type: "notice",
      label: `No ${PROVIDER_NAMES[assistant.modelProvider]} credential configured, answering with ${PROVIDER_NAMES[resolved.provider]} (${resolved.modelId}) instead`,
    });
  }

  // No LLM configured anywhere → deterministic demo engine (ADR-0003), same
  // wire events. search_knowledge still runs a real (lexical) search.
  if (!chatModel && !courtesyFlow) {
    // Preview only, for the same reason as the fallback notice above: "this
    // organization has no provider credential, add one in Settings → AI" is an
    // instruction to an admin. A Visitor can act on none of it, and it exposes
    // the tenant's configuration state.
    if (isOperatorSurface(keyResolution)) {
      emit({
        type: "notice",
        label:
          "No AI provider credential configured for this organization, using keyword matching (add a provider connection in Settings → AI)",
      });
    }
    const flow = resumedFlow ?? requestedStudyFlow ?? matchFlow(message, flows, routing);
    if (!flow) {
      const part: ChatReplyPart = {
        type: "text",
        action: "fallback",
        text: "No enabled flow can handle this message, enable the Default behavior flow or add a new one.",
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
    emit({ type: "notice", label: flow.id === STUDY_MODE_FLOW_ID ? "Study Mode" : `Matched flow “${flow.name}” (keyword matching)` });
    emit({
      type: "flow",
      flowId: storedFlowId(flow),
      flowName: flow.name,
      isDefault: flow.isDefault,
    });
    const parts: ChatReplyPart[] = [];
    const effects: ActionEffect[] = [];
    const ctx: ActionContext = {
      idempotencyKey: effectKeyPrefix,
      assistant,
      platformPrompt,
      persona,
      flow,
      message,
      history,
      collectionId,
      templateContext: resumeContext(withWorkflowName(templateContext, flow.name)),
      chatModel: null,
      searchKnowledge,
      session,
      skills,
      longTermMemory,
      searchMemories,
      entities,
      queryEntityRecords,
      connectorRuntime,
      reviewRuntime,
      countOperation,
      judgeAction,
      webhookRuntime,
      toolSubject,
      priorParts: parts,
      emit,
      signal,
      previewSurface: isOperatorSurface(keyResolution),
      recommendHelpDesk,
    };

    const { handoverTo } = await dispatchActions({
      ctx,
      parts,
      effects,
      signal,
      startIndex: resumeIndex,
      onActionError: (action) => ({
        type: "text",
        action: "fallback",
        text: `The "${action}" step could not be completed. Please try again.`,
      }),
    });
    return {
      parts,
      effects,
      flowId: storedFlowId(flow),
      flowName: flow.name,
      usage: [],
      handoverTo,
    };
  }

  // The pre-flight (#952, #953). It is skipped whenever the turn never
  // classifies. A resumed Flow already knows where it is going, and a courtesy
  // hit is Basic Interaction, whose whole promise is that it spends nothing and
  // leaves no trace; asking a decision model about "grazie" would contradict
  // the feature it sits beside. Proactive triggers never reach here at all:
  // they run in `runProactiveFlows` with no message to ask about.
  //
  // Two modes, one call. In **shadow** the decision overlaps Intent
  // Classification (a warm decision lands in about 300 ms, well inside a
  // classification) and is read afterwards, routing nothing. With **routing**
  // on it is awaited first, because a decision that clears its threshold
  // replaces the classification call, and a call already in flight cannot be
  // un-made; an under-threshold turn then pays the decision's latency before
  // today's path, which is the cost the spec accepts for one model call
  // instead of two on the turns that route.
  const host = getRuntimeHost();
  const routingEnabled = host.preflightRoutingEnabled();
  const asks =
    !resumedFlow && !requestedStudyFlow && !courtesyFlow && loadPreflightCatalogue !== undefined &&
    (routingEnabled || host.preflightShadowEnabled());
  let shadowPending: Promise<PreflightOutcome | null> | null = null;
  let preflightOutcome: PreflightOutcome | null = null;
  if (asks) {
    if (routingEnabled) preflightOutcome = await startPreflight();
    else shadowPending = startPreflight();
  }
  // The fixed line for the outcome, in the Visitor's language (#946): the
  // closed table takes no Flow and no Organization data, which is what keeps
  // a Flow name off a stranger's screen. A verbatim Flow earns no line, its
  // reply is the next thing on screen.
  const preflightLine = (): void => {
    if (!preflightOutcome?.decision) return;
    const outcome = thinkingOutcome(preflightOutcome.record.wouldRoute, {
      flows: flowCandidates,
      faqs: [],
      desks: [],
    });
    if (outcome) {
      emit({
        type: "thought",
        text: thinkingLine(outcome, spokenLanguage(preflightOutcome.decision), visitorLocale),
      });
    }
  };
  const actedRecord = (): PreflightTraceRecord | undefined =>
    preflightOutcome ? { ...preflightOutcome.record, routedFlowId: null, acted: true } : undefined;

  // What the pre-flight decided, when it decided anything and routing is on.
  const preflightRoute = decidedRoute(preflightOutcome);

  // The FAQ direct hit (#954): the curated answer verbatim, cited to the FAQ,
  // with no retrieval and no generation. Same render as the quick-reply FAQ
  // button, and the same "FAQ" marker on the transcript and the export. An
  // FAQ that is gone since the catalogue read falls to today's path.
  if (preflightRoute?.kind === "faq" && readPreflightFaq) {
    const faq = await readPreflightFaq(preflightRoute.faqId).catch(() => null);
    if (faq) {
      preflightLine();
      emit({ type: "flow", flowId: null, flowName: "FAQ", isDefault: false });
      const textPart: ChatReplyPart = { type: "text", action: "custom_message", text: faq.body };
      const sourcesPart: ChatReplyPart = {
        type: "sources",
        action: "search_knowledge",
        sources: [
          {
            conceptId: preflightRoute.faqId,
            conceptTitle: faq.title,
            collectionName: faq.collectionName,
            sourceName: null,
            url: faq.url,
          },
        ],
      };
      emit({ type: "part", part: textPart });
      emit({ type: "part", part: sourcesPart });
      const preflight = actedRecord();
      return {
        parts: [textPart, sourcesPart],
        effects: [],
        flowId: null,
        flowName: "FAQ",
        usage: usageEvents,
        ...(preflight ? { preflight } : {}),
      };
    }
  }

  // Escalation from the pre-flight (#955): a Visitor who asked for a person,
  // above threshold, gets the chip at once, opened on the desk the pre-flight
  // chose among the Assistant's selected desks when that choice cleared its
  // own threshold, and the generic menu otherwise. The separate help-desk
  // recommendation call is not made: this is that recommendation. Nothing is
  // classified, retrieved or generated; the chip is the reply, as it is for
  // the suggest_help_desk action on its own.
  if (preflightRoute?.kind === "escalation") {
    preflightLine();
    emit({ type: "flow", flowId: null, flowName: "Escalation", isDefault: false });
    const part: ChatReplyPart = {
      type: "help_desk",
      action: "suggest_help_desk",
      label: contactLabel(assistant),
      ...(preflightRoute.deskId ? { helpDeskId: preflightRoute.deskId } : {}),
    };
    emit({ type: "part", part });
    const preflight = actedRecord();
    return {
      parts: [part],
      effects: [],
      flowId: null,
      flowName: "Escalation",
      usage: usageEvents,
      ...(preflight ? { preflight } : {}),
    };
  }

  const routedByPreflight = preflightOutcome ? preflightRoutedFlow(preflightOutcome, flows) : null;
  if (routedByPreflight) preflightLine();

  const flow =
    resumedFlow ??
    requestedStudyFlow ??
    courtesyFlow ??
    routedByPreflight ??
    (await classifyIntent(
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
      routing,
      emit
    ));

  // The record is completed with the Flow the turn actually took and goes to
  // the trace; `acted` says whether that Flow was the pre-flight's own choice
  // or classification's, so the two fields read as a comparison on a shadow
  // record and as a fact on a routed one.
  const observed = preflightOutcome ?? (await shadowPending);
  const preflight: PreflightTraceRecord | undefined = observed
    ? {
        ...observed.record,
        routedFlowId: flow?.id ?? null,
        ...(routedByPreflight ? { acted: true } : {}),
      }
    : undefined;

  if (!flow) {
    const part: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: "No enabled flow can handle this message, enable the Default behavior flow or add a new one.",
    };
    emit({ type: "flow", flowId: null, flowName: "No flow", isDefault: true });
    emit({ type: "part", part });
    return {
      parts: [part],
      effects: [],
      flowId: null,
      flowName: "No flow",
      usage: usageEvents,
      ...(preflight ? { preflight } : {}),
    };
  }

  // The routing decision, stated once the classifier has made it, the emitter
  // knows which flow matched, so the trace row carries it directly instead of a
  // later event patching an earlier row (#560). Skipped for a courtesy turn:
  // no classification happened, and the one notice would be the only thing
  // standing between that turn and a null trace (#566).
  if (flow.id === STUDY_MODE_FLOW_ID) {
    emit({ type: "notice", label: "Study Mode", detail: "Preparing an interactive exercise" });
  } else if (!courtesyFlow && !resumedFlow && !routedByPreflight) {
    emit({
      type: "notice",
      label: "Classifying intent",
      detail: `Matched flow “${flow.name}”`,
    });
  }
  emit({
    type: "flow",
    flowId: storedFlowId(flow),
    flowName: flow.name,
    isDefault: flow.isDefault,
  });

  // Kicked off in parallel with the actions; consulted after they finish.
  const trustTierPromise: Promise<TrustTier | null> = options.getFlowTrust && flow.id !== STUDY_MODE_FLOW_ID
    ? options.getFlowTrust(flow.id).catch(() => null)
    : Promise.resolve(null);

  const parts: ChatReplyPart[] = [];
  const effects: ActionEffect[] = [];
  const ctx: ActionContext = {
    chooseStudyFormat: async (formats, topic) => {
      const fallback = formats[0];
      const resolved = resolveDecisionModel(assistant.modelProvider, connections, keyResolution);
      if (!resolved || resolved.backend !== "jev" || formats.length < 2) return fallback;
      try {
        const result = await decide(resolved, {
          state: { request: message, topic },
          questions: { format: { type: "choice", instructions: "Choose the most useful study exercise format. Respect a format explicitly requested by the visitor.", criteria: Object.fromEntries(formats.map(format => [format, format.replaceAll("_", " ")])) } },
          abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
        });
        usageEvents.push(result.usage);
        const chosen = result.answers.format.choice;
        return formats.find(format => format === chosen) ?? fallback;
      } catch {
        if (signal?.aborted) throw signal.reason;
        return fallback;
      }
    },
    idempotencyKey: effectKeyPrefix,
    assistant,
    platformPrompt,
    persona,
    flow,
    message,
    history,
    collectionId,
    templateContext: resumeContext(withWorkflowName(templateContext, flow.name)),
    chatModel,
    fastModel: classifier?.model ?? null,
    searchKnowledge,
    readKnowledgeDocument,
    apiIntegration,
    teammateActions,
    memoryDocuments,
    untrustedContext,
    referralCandidates,
    session,
    alreadyClarified,
    skills,
    longTermMemory,
    searchMemories,
    entities,
    queryEntityRecords,
    connectorRuntime,
    reviewRuntime,
    countOperation,
    judgeAction,
    webhookRuntime,
    toolSubject,
    priorParts: parts,
    emit,
    signal,
    previewSurface: isOperatorSurface(keyResolution),
    recommendHelpDesk,
    // Pre-bound with the turn's resolved chat model so handlers only report
    // token totals. Null-guarded rather than assumed: a courtesy turn reaches
    // this path with no resolvable model (the handler answers verbatim), and a
    // handler that made no call has nothing to meter anyway.
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
    // Metered against the classifier-tier model that actually ran, still as a
    // `generate` event: the stage says what the call produced, the model id
    // says who produced it.
    recordFastUsage: (usage) => {
      if (!classifier) return;
      usageEvents.push({
        stage: "generate",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
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
    startIndex: resumeIndex,
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
      const diagnostic = isOperatorSurface(keyResolution);
      return {
        type: "text",
        action: "fallback",
        text: diagnostic
          ? `The "${action}" step failed (${errorMessageOf(error)}). Check the provider configuration in Settings → AI.`
          : "Sorry, I ran into a problem answering that. Please try again in a moment.",
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
  // answers (flow trust ledger, the one behavioral consequence in v1).
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
    flowId: storedFlowId(flow),
    flowName: flow.name,
    usage: usageEvents,
    ...(preflight ? { preflight } : {}),
    handoverTo,
  };
}
