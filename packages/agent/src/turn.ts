import type {
  Assistant,
  BudgetEnforcement,
  ConversationMetadata,
  ConversationSubject,
  Flow,
  FlowTrigger,
  ProactiveTriggerContext,
  ProviderConnection,
  SkillSnapshot,
  TrustTier,
} from "@agent-hub/core";
import {
  messageText,
  needsVisitorDeliveryHistory,
  notificationDelivery,
  proactiveFlowCandidates,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import type { ChatReplyPart } from "./types";
import { contactLabel } from "./actions";
import { meterUsage } from "./usage";
import { recordRuntimeEvent, errorClassOf } from "./telemetry";
import { embedText } from "./embeddings";
import { withGraphEngine } from "./graph-search";
import {
  runAssistantChat,
  runProactiveFlows,
  type HistoryMessage,
  type KnowledgeSearcher,
  type ProviderHealthEvent,
  type RuntimeEvent,
} from "./engine";
import { applyEffects } from "./effects";
import { buildTemplateContext } from "./template";
import { createTurnSession } from "./session";
import { EMPTY_TURN_TRACE, foldTraceEvent, type TurnTrace } from "./stream";
import { prepareTraceForStorage } from "./trace";
import { alertKeys, signalHealth } from "./health";
import {
  getEnterpriseCapabilities,
  type ActivationState,
  type UsageOutcome,
} from "./ee";
import { resolveChatModel, type KeyResolution } from "./models";
import type { UsageEvent } from "./types";
import type { EscalationDeskCandidate } from "./help-desk-recommend";
import { getRuntimeHost } from "./host";

/**
 * Origin of the tenant-facing web app (apps/web) for {{conversation.link}} —
 * the Inbox lives under its (admin) route group. Falls back to the known
 * production host when unset.
 */
function platformAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://platform.ciele.app"
  );
}

/**
 * Conversation Turn (see context.md): one user message and everything the
 * runtime does to answer it — get-or-create the Conversation, persist the
 * user message, route through the flow engine, persist the assistant reply
 * with its flow markers, apply deferred effects, and stream ndjson
 * RuntimeEvents to the client.
 *
 * Both chat entrypoints are thin adapters over this seam: the Widget runs a
 * Publication snapshot for a Visitor, Preview runs live config for a Member.
 * The wire format (one JSON RuntimeEvent per line) lives only here.
 */
export interface ConversationTurnInput {
  /** Data access, already scoped by the caller (session db or widget db). */
  db: Db;
  /** Config the turn runs on — a Publication snapshot or live rows. */
  assistant: Assistant;
  flows: Flow[];
  /** Attached Skills — a Publication snapshot (widget) or live rows (preview). */
  skills?: SkillSnapshot[];
  connections: ProviderConnection[];
  organizationId: string;
  /** Who is speaking: a Visitor (widget) or a Member (preview). */
  subjectType: ConversationSubject;
  subjectId: string;
  /**
   * Conversation to continue. Reused only when it belongs to the same
   * subject and assistant; otherwise a fresh Conversation is started.
   */
  conversationId?: string | null;
  /** Knowledge Collection anchor, applied when a Conversation is created. */
  collectionId?: string | null;
  message: string;
  /**
   * Set when the message came from an FAQ quick reply: the turn answers with
   * the matching FAQ Concept's curated body verbatim (no model call), cited
   * to the Concept. An unmatched question falls through to the normal flow.
   */
  faqQuestion?: boolean;
  /** Session context stored on a newly-created Conversation. */
  metadata?: ConversationMetadata;
  signal: AbortSignal;
  /**
   * Surface context for provider resolution. Omit for published widget traffic;
   * Preview passes `{ surface: "preview", memberId }` for future per-user
   * mechanisms. Hosted subscription Provider Connections are retired.
   */
  keyResolution?: KeyResolution;
  /**
   * The event that started this turn (#541). Absent or `"message"` is the
   * Visitor-message turn every existing caller runs. A proactive trigger
   * (`chat_open`, and later `page_load` / `time_on_page`) selects its flows by
   * the trigger instead of Intent Classification, persists no user message, and
   * calls no model — `message` is ignored and may be empty.
   */
  trigger?: FlowTrigger;
  /**
   * What the fired event knows about itself — today the dwell the client reports
   * for `time_on_page`. Re-checked against each flow's configured threshold, so a
   * short or replayed report cannot make a nudge fire early.
   */
  triggerContext?: ProactiveTriggerContext;
}

/** Response headers matching the stream framing below. */
export const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache",
} as const;

export const RECENT_HISTORY_LIMIT = 12;

/**
 * Live turn-time trust read for a routed flow (flow trust ledger). Trust is
 * earned, never presumed from absence of data: a flow with no materialized row
 * yet has earned nothing, so it reads as `watch` (its generative answers always
 * offer human escalation) until it accrues graded history. Only an infrastructure
 * read *error* stays fail-open (`null` → the engine changes nothing) — absence of
 * history must never silently grant more autonomy than a measured flow would.
 */
export function readFlowTrustTier(
  db: Db,
  assistantId: string,
  flowId: string
): Promise<TrustTier | null> {
  return db
    .getFlowTrust(assistantId, flowId)
    .then((trust) => trust?.tier ?? "watch")
    .catch(() => null);
}

/**
 * Rolls a turn's per-call usage events into the single turn-level telemetry
 * record: total tokens in/out, and the provider/model that actually answered
 * (the last generative call, post cross-provider fallback). The deterministic
 * no-model path meters zero with a null provider/model.
 */
function summarizeTurnUsage(usage: UsageEvent[]): {
  inputTokens: number;
  outputTokens: number;
  provider: UsageEvent["provider"] | null;
  modelId: string | null;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let answered: UsageEvent | null = null;
  for (const u of usage) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    if (u.stage === "generate") answered = u;
  }
  const picked = answered ?? usage.at(-1) ?? null;
  return {
    inputTokens,
    outputTokens,
    provider: picked?.provider ?? null,
    modelId: picked?.modelId ?? null,
  };
}

export async function recordProviderHealth(input: {
  db: Db;
  organizationId: string;
  assistantTitle: string;
  event: ProviderHealthEvent;
}): Promise<void> {
  const key = alertKeys.provider(input.event.provider, input.event.credentialKind);
  await signalHealth(
    input.db,
    input.organizationId,
    input.event.ok
      ? { key, healthy: true }
      : {
          key,
          healthy: false,
          alert: {
            type: "provider",
            title:
              input.event.provider === "google"
                ? "Google Vertex federated auth failed"
                : "Federated provider auth failed",
            detail: `${input.assistantTitle} failed to answer using ${input.event.provider} ${input.event.credentialKind}. ${input.event.detail ?? "Check the provider connection in Settings > AI."}`,
          },
        },
    "provider-health"
  );
}

/**
 * Pre-turn budget check. Over budget: raises one refresh-while-active Alert
 * per org; under budget (with a limit configured): auto-resolves it. Fails
 * open — accounting problems must never take the assistant down.
 */
async function checkOrgBudget(
  db: Db,
  organizationId: string
): Promise<{ overBudget: boolean; enforcement: BudgetEnforcement }> {
  try {
    const budget = await db.getOrgBudget(organizationId);
    if (budget?.dailyTokenLimit == null && budget?.dailyEuroLimit == null) {
      return { overBudget: false, enforcement: "notify" };
    }
    const reasons: string[] = [];
    let overBudget = false;
    if (budget.dailyTokenLimit != null) {
      const usedTokens = await db.getOrgTokensUsedToday(organizationId);
      if (usedTokens >= budget.dailyTokenLimit) {
        overBudget = true;
        reasons.push(
          `${usedTokens.toLocaleString("en-US")} of ${budget.dailyTokenLimit.toLocaleString("en-US")} tokens`
        );
      }
    }
    if (budget.dailyEuroLimit != null) {
      const usedEur = await db.getOrgCostUsedToday(organizationId);
      if (usedEur >= budget.dailyEuroLimit) {
        overBudget = true;
        reasons.push(
          `€${usedEur.toFixed(2)} of €${budget.dailyEuroLimit.toFixed(2)}`
        );
      }
    }
    const key = alertKeys.budget(organizationId);
    await signalHealth(
      db,
      organizationId,
      overBudget
        ? {
            key,
            healthy: false,
            alert: {
              type: "system",
              title: "Daily AI budget reached",
              detail: `Assistants used ${reasons.join(" and ")} today (UTC).${
                budget.enforcement === "block"
                  ? " New AI answers are paused until the window resets."
                  : " Answers continue normally (notify-only enforcement)."
              }`,
            },
          }
        : { key, healthy: true },
      "budget"
    );
    return { overBudget, enforcement: budget.enforcement };
  } catch (error) {
    console.error("[runtime] budget check failed:", error);
    return { overBudget: false, enforcement: "notify" };
  }
}

/**
 * Which credential kind this turn's chat model would run on — the same
 * resolution the engine performs, done up front so the plan-cap gate (#442)
 * knows whether the turn is platform-funded. Null means no model resolves
 * (the deterministic no-model path): nothing is funded, nothing to gate.
 */
export function turnConnectionKind(
  assistant: Assistant,
  connections: ProviderConnection[],
  keyResolution: KeyResolution = {}
): "platform" | "byok" | null {
  const resolved = resolveChatModel(
    assistant.modelProvider,
    assistant.modelId,
    connections,
    keyResolution
  );
  if (!resolved) return null;
  return resolved.credentialKind === "platform" ? "platform" : "byok";
}

/** A turn that decided there is nothing to say: no db writes, no wire events. */
function silentTurn(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

/**
 * The proactive half of the Conversation Turn (#541): a client event fired, so
 * the trigger selects the flows instead of Intent Classification.
 *
 * Three things make it cheaper than a message turn, and all three are load-bearing:
 * it resolves **no model** (a Notification is verbatim, so the turn is free and
 * meters nothing), it persists **no user message** (nobody spoke), and it touches
 * the database **only once it knows something will be delivered** — otherwise every
 * page view on a site with no proactive flows would mint a Conversation.
 *
 * The spend-based gates (daily budget, plan cap) do not apply to a turn that spends
 * nothing. Activation does: an organization that is not yet a customer should not be
 * messaging visitors unprompted.
 */
async function streamProactiveTurn(
  input: ConversationTurnInput & { trigger: FlowTrigger }
): Promise<ReadableStream<Uint8Array>> {
  const { db, assistant, subjectType, subjectId, signal, trigger } = input;
  const turnStart = Date.now();
  const surface =
    input.keyResolution?.surface === "preview" ? "preview" : "widget";

  const candidates = proactiveFlowCandidates(input.flows, trigger, {
    // The same objective facts the message funnel gates on (spec #550): the page
    // the event was reported from, and the clock. A proactive flow has no
    // conditions today, so this only matters if one is ever stored — better to
    // bind it than to ignore it on this funnel alone.
    url: input.metadata?.launchUrl,
    now: new Date(),
    ...(input.triggerContext ?? {}),
  });
  if (candidates.length === 0) return silentTurn();

  let activation: ActivationState = { state: "active" };
  try {
    activation = await getEnterpriseCapabilities().activation.getActivation(
      input.organizationId
    );
  } catch (error) {
    console.error("[runtime] activation check failed (failing open):", error);
  }
  if (activation.state === "pending") return silentTurn();

  let conversation = input.conversationId
    ? await db.getConversation(input.conversationId)
    : null;
  if (
    conversation &&
    (conversation.subjectId !== subjectId ||
      conversation.assistantId !== assistant.id)
  ) {
    conversation = null;
  }

  // The "once per Visitor" rule spans Conversations, so it needs the Visitor's
  // other session states. Read only when a candidate actually asks for it, and
  // fail narrow: if the read fails, that rule behaves like once-per-session
  // rather than delivering again.
  let visitorStates: Array<Record<string, unknown>> = [];
  if (surface !== "preview" && needsVisitorDeliveryHistory(candidates)) {
    try {
      const others = await db.listConversations(
        assistant.id,
        subjectType,
        subjectId
      );
      visitorStates = others
        .filter((other) => other.id !== conversation?.id)
        .map((other) => other.sessionState ?? {});
    } catch (error) {
      console.error("[runtime] visitor delivery history read failed:", error);
    }
  }

  // The delivery rule is the server's decision, so a reopen loop or a replayed
  // event report re-asks it and gets the same answer. Each surviving flow's patch
  // folds into the working state, so two nudges on one trigger both get recorded.
  let workingState: Record<string, unknown> = conversation?.sessionState ?? {};
  const statePatches: Record<string, unknown> = {};
  const deliverable: Flow[] = [];
  for (const flow of candidates) {
    // Preview is a demo surface, not a Visitor session (#545): an admin who hits
    // Refresh expects to see the nudge again, so the delivery rule — which exists
    // to protect a real Visitor from repetition — does not apply there.
    if (surface === "preview") {
      deliverable.push(flow);
      continue;
    }
    const decision = notificationDelivery(flow, {
      sessionState: workingState,
      visitorStates,
    });
    if (!decision.deliver) continue;
    deliverable.push(flow);
    if (decision.sessionPatch) {
      workingState = { ...workingState, ...decision.sessionPatch };
      Object.assign(statePatches, decision.sessionPatch);
    }
  }
  if (deliverable.length === 0) return silentTurn();

  if (!conversation) {
    conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType,
      subjectId,
      collectionId: input.collectionId ?? null,
      title: deliverable[0].name.slice(0, 80),
      metadata: input.metadata,
    });
  }

  const conversationId = conversation.id;
  const session = createTurnSession(conversationId, conversation.sessionState);
  const platformPrompt = await getRuntimeHost().getPlatformSystemPrompt();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const emit = (event: RuntimeEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      emit({ type: "turn", conversationId });
      try {
        const result = await runProactiveFlows({
          assistant,
          platformPrompt,
          flows: deliverable,
          templateContext: buildTemplateContext({
            user: {
              name: conversation.metadata.userName,
              email: conversation.metadata.userEmail,
              id: conversation.subjectId,
            },
            message: "",
            history: [],
            metadata: conversation.metadata,
            conversationId,
            appOrigin: platformAppOrigin(),
          }),
          session,
          skills: input.skills,
          emit,
          signal,
          keyResolution: input.keyResolution,
        });
        if (signal.aborted) {
          throw new DOMException("Conversation turn aborted", "AbortError");
        }
        // A flow that produced nothing was never delivered, so its delivery must
        // not be recorded either — the Visitor can still receive it later.
        if (result.parts.length === 0) {
          controller.close();
          return;
        }
        const saved = await db.appendMessage({
          conversationId,
          role: "assistant",
          content: result.parts,
          flowId: result.flowId,
          flowName: result.flowName,
        });
        for (const [key, value] of Object.entries(statePatches)) {
          session.set(key, value);
        }
        if (session.dirty) {
          try {
            await db.updateConversationSessionState(
              conversationId,
              session.snapshot()
            );
          } catch (error) {
            console.error("[runtime] session-state persist failed:", error);
          }
        }
        if (result.effects.length > 0) {
          await applyEffects(result.effects, {
            db,
            organizationId: input.organizationId,
            messageId: saved.id,
          });
        }
        emit({ type: "done", conversationId, messageId: saved.id });
        await recordRuntimeEvent(db, {
          organizationId: input.organizationId,
          assistantId: assistant.id,
          conversationId,
          messageId: saved.id,
          kind: "chat_turn",
          status: "succeeded",
          surface,
          flowId: result.flowId,
          flowName: result.flowName,
          durationMs: Date.now() - turnStart,
          inputTokens: 0,
          outputTokens: 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (!signal.aborted) emit({ type: "error", message });
        await recordRuntimeEvent(db, {
          organizationId: input.organizationId,
          assistantId: assistant.id,
          conversationId,
          kind: "chat_turn",
          status: "failed",
          surface,
          durationMs: Date.now() - turnStart,
          errorClass: errorClassOf(error),
          errorMessage: message,
        });
      } finally {
        controller.close();
      }
    },
  });
}

export async function streamConversationTurn(
  input: ConversationTurnInput
): Promise<ReadableStream<Uint8Array>> {
  const { db, assistant, message, subjectType, subjectId, signal } = input;

  // A proactive trigger takes the same seam but a different path: no
  // classification, no model, no user message (#541).
  const trigger = input.trigger ?? "message";
  if (trigger !== "message") {
    return streamProactiveTurn({ ...input, trigger });
  }

  // Runtime telemetry (ADR-0011): one `chat_turn` event per turn, attributed
  // to org/assistant/conversation and stamped with latency, tokens, tool
  // calls, and error outcome. Written post-commit and fire-safe, so the sink
  // never breaks or slows a user-visible turn.
  const turnStart = Date.now();
  const surface =
    input.keyResolution?.surface === "preview" ? "preview" : "widget";

  // Budget bookkeeping happens up front. Notify mode only raises/resolves the
  // Alert; block mode answers with a fixed unavailable reply below (the
  // exchange still persists — a Visitor is never silently dropped).
  const budget = await checkOrgBudget(db, input.organizationId);

  // Plan-cap gate (#442): the enterprise metering capability decides at turn
  // start whether platform-funded traffic may still run this month. The OSS
  // default allows everything, and BYOK turns are never blocked (a customer's
  // own keys are their own cost). Fails open like the budget check —
  // enforcement problems must never take the assistant down.
  let usageGate: UsageOutcome = { outcome: "allow" };
  const connectionKind = turnConnectionKind(
    assistant,
    input.connections,
    input.keyResolution
  );
  if (connectionKind) {
    try {
      usageGate = await getEnterpriseCapabilities().metering.checkUsage({
        organizationId: input.organizationId,
        connectionKind,
        // A conversation turn spends the AI allowance; indexing and crawling
        // have their own meters and their own gates (#510).
        resource: "ai",
      });
    } catch (error) {
      console.error("[runtime] usage check failed (failing open):", error);
    }
  }

  // Organization activation (#444). Unlike the usage cap this is not about
  // how much has been spent but about whether this organization may run at
  // all: on the managed platform a fresh signup waits for activation. It
  // applies to BYOK traffic too — a pending organization is not yet a
  // customer, so there is no bring-your-own-key bypass. Self-hosted
  // deployments never see it: the OSS default is unconditionally active.
  let activation: ActivationState = { state: "active" };
  try {
    activation = await getEnterpriseCapabilities().activation.getActivation(
      input.organizationId
    );
  } catch (error) {
    console.error("[runtime] activation check failed (failing open):", error);
  }

  let conversation = input.conversationId
    ? await db.getConversation(input.conversationId)
    : null;
  if (
    conversation &&
    (conversation.subjectId !== subjectId ||
      conversation.assistantId !== assistant.id)
  ) {
    conversation = null;
  }
  if (!conversation) {
    conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType,
      subjectId,
      collectionId: input.collectionId ?? null,
      title: message.slice(0, 80),
      metadata: input.metadata,
    });
  }

  const collectionId = input.collectionId ?? conversation.collectionId ?? null;
  const vectorSearch: KnowledgeSearcher = async (query, options) => {
    // Agentic Search scope-tier widen (#155): an "assistant" pass drops the
    // anchored Collection filter (null = assistant-wide); "collection"/default
    // keeps it. searchChunks already treats a null collection as assistant-wide.
    const scoped = options?.scope === "assistant" ? null : collectionId;
    const embedding = await embedText(query, input.connections, {
      db,
      organizationId: input.organizationId,
      assistantId: assistant.id,
      conversationId,
    });
    return db.searchChunks(assistant.id, scoped, {
      embedding,
      text: query,
      limit: 6,
    });
  };
  // Knowledge Engine (ADR-0017): Graph is primary; the graph searcher retrieves
  // from the derived Knowledge Graph and hydrates provenance to Concept→Source,
  // falling back to vector on any error / assistant-wide widen / missing worker.
  // The graph QA id for this turn is captured for the feedback substrate (#389).
  let graphQaId: string | null = null;
  const searchKnowledge: KnowledgeSearcher = withGraphEngine({
    db,
    organizationId: input.organizationId,
    assistantId: assistant.id,
    collectionId,
    conversationId: conversation.id,
    useGraph: (assistant.knowledgeEngine ?? "graph") === "graph",
    vector: vectorSearch,
    onTrace: (qaId) => {
      graphQaId = qaId;
    },
  });

  const stored = await db.listRecentMessages(
    conversation.id,
    RECENT_HISTORY_LIMIT
  );
  // Tau-style session: the conversation's persistent state bag, exposed to
  // tools for this turn and written back below only if something changed.
  const session = createTurnSession(conversation.id, conversation.sessionState);
  const history: HistoryMessage[] = stored.map((m) => ({
    role: m.role,
    text: messageText(m.content),
  }));
  // The anti-loop guarantee (#558): a clarify part is persisted in a prior
  // assistant message's content parts, so no schema is needed to know this
  // conversation already asked the Visitor to rephrase. Asking twice is a loop
  // and reads as the assistant refusing to try, so the terminal tool coerces a
  // second request into a best-effort answer.
  const alreadyClarified = stored.some(
    (m) =>
      m.role === "assistant" &&
      m.content.some((p) => (p as { type?: string }).type === "clarify")
  );

  await db.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: [{ type: "text", text: message }],
  });

  // The immutable platform (Ciele) prompt layer — same for every org.
  const platformPrompt = await getRuntimeHost().getPlatformSystemPrompt();

  const conversationId = conversation.id;
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let toolCalls = 0;
      // The turn folds the events it is emitting through the SAME fold the
      // chat clients use (stream.ts), so what the Inbox reads back later is
      // what the visitor watched happen — not a second reconstruction of it.
      let trace: TurnTrace = EMPTY_TURN_TRACE;
      const emit = (event: RuntimeEvent) => {
        if (event.type === "tool-start") toolCalls += 1;
        trace = foldTraceEvent(trace, event);
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      emit({ type: "turn", conversationId });
      /**
       * The one terminal-turn ritual — persist the assistant message, run any
       * post-persist bookkeeping, emit `done`, record the `chat_turn`
       * telemetry. Every successful path (budget-block, FAQ quick reply,
       * normal completion) ends here, so the persistence/telemetry contract
       * has a single home.
       */
      const finishTurn = async (turn: {
        parts: ChatReplyPart[];
        flowId: string | null;
        flowName: string;
        /** Extra telemetry fields (usage, toolCalls, flowId) beyond the base. */
        telemetry?: Partial<Parameters<typeof recordRuntimeEvent>[1]>;
        /** Bookkeeping between persist and `done` (usage ledger, session, effects). */
        afterPersist?: (messageId: string) => Promise<void>;
      }): Promise<void> => {
        const saved = await db.appendMessage({
          conversationId,
          role: "assistant",
          content: turn.parts,
          flowId: turn.flowId,
          flowName: turn.flowName,
          // Null for a turn that did no agentic work (a verbatim message, a
          // proactive Notification, a pre-engine gate) — see trace.ts.
          trace: prepareTraceForStorage(trace),
        });
        await turn.afterPersist?.(saved.id);
        emit({ type: "done", conversationId, messageId: saved.id });
        await recordRuntimeEvent(db, {
          organizationId: input.organizationId,
          assistantId: assistant.id,
          conversationId,
          messageId: saved.id,
          kind: "chat_turn",
          status: "succeeded",
          surface,
          flowName: turn.flowName,
          durationMs: Date.now() - turnStart,
          ...turn.telemetry,
        });
      };
      /**
       * A pre-engine gate's fixed reply: skip every model call, answer with
       * neutral copy plus the escalation offer, and persist the exchange like
       * any turn — a Visitor is never silently dropped.
       */
      const gatedReply = async (flowName: string, text: string) => {
        emit({ type: "flow", flowId: null, flowName, isDefault: false });
        const textPart: ChatReplyPart = { type: "text", action: "fallback", text };
        const helpPart: ChatReplyPart = {
          type: "help_desk",
          action: "suggest_help_desk",
          label: contactLabel(assistant),
        };
        emit({ type: "part", part: textPart });
        emit({ type: "part", part: helpPart });
        await finishTurn({ parts: [textPart, helpPart], flowId: null, flowName });
      };
      try {
        if (budget.overBudget && budget.enforcement === "block") {
          // Hard daily-budget ceiling.
          await gatedReply(
            "Budget limit",
            "The assistant has reached its daily usage limit and will be back soon. For anything urgent, please contact support."
          );
          return;
        }
        if (activation.state === "pending") {
          // No model call, no credential handed out — the organization is not
          // active yet. Everything they configured is untouched; activating
          // them makes the same assistant answer.
          await gatedReply("Pending activation", activation.visitorMessage);
          return;
        }
        if (usageGate.outcome === "block") {
          // Plan cap reached (#442): platform-funded traffic pauses with a
          // graceful reply; the enterprise capability wrote the admin-facing
          // upgrade prompt as an Alert.
          await gatedReply("Usage limit", usageGate.message);
          return;
        }
        // FAQ quick reply: answer with the curated FAQ body verbatim — no
        // model call, cited to the Concept, persisted like any turn. An
        // unmatched (deleted/renamed) FAQ falls through to the normal flow.
        if (input.faqQuestion) {
          const match = await db
            .findFaqConcept(assistant.id, message)
            .catch(() => null);
          if (match) {
            emit({ type: "flow", flowId: null, flowName: "FAQ", isDefault: false });
            const textPart: ChatReplyPart = {
              type: "text",
              action: "custom_message",
              text: match.concept.body,
            };
            const sourcesPart: ChatReplyPart = {
              type: "sources",
              action: "search_knowledge",
              sources: [
                {
                  conceptId: match.concept.id,
                  conceptTitle:
                    match.concept.frontmatter.title ?? match.concept.path,
                  collectionName: match.collectionName,
                  sourceName: null,
                  url: match.concept.frontmatter.resource ?? null,
                },
              ],
            };
            emit({ type: "part", part: textPart });
            emit({ type: "part", part: sourcesPart });
            await finishTurn({
              parts: [textPart, sourcesPart],
              flowId: null,
              flowName: "FAQ",
            });
            return;
          }
        }
        // "AI recommended help desk" candidates: resolved live (desk
        // descriptions are org data, never snapshotted into Publications);
        // any failure degrades to the generic escalation menu.
        let escalationDesks: EscalationDeskCandidate[] = [];
        if (assistant.helpDeskSettings?.aiRecommended) {
          const selected = assistant.helpDeskSettings.selectedIds ?? [];
          if (selected.length > 0) {
            try {
              escalationDesks = (await db.listHelpDesks(input.organizationId))
                .filter((desk) => selected.includes(desk.id))
                .map((desk) => ({
                  id: desk.id,
                  name: desk.name,
                  description: desk.description ?? "",
                }));
            } catch {
              escalationDesks = [];
            }
          }
        }
        const result = await runAssistantChat({
          assistant,
          platformPrompt,
          flows: input.flows,
          connections: input.connections,
          message,
          history,
          templateContext: buildTemplateContext({
            user: {
              name: conversation.metadata.userName,
              email: conversation.metadata.userEmail,
              id: conversation.subjectId,
            },
            message,
            history,
            metadata: conversation.metadata,
            conversationId,
            appOrigin: platformAppOrigin(),
          }),
          // Objective Flow Conditions are gated against the page the
          // Conversation was launched from (spec #550) — captured once at
          // launch, so mid-conversation navigation is not re-evaluated.
          routing: {
            url: conversation.metadata.launchUrl,
            now: new Date(),
          },
          searchKnowledge,
          collectionId,
          session,
          alreadyClarified,
          skills: input.skills,
          escalationDesks,
          emit,
          signal,
          keyResolution: input.keyResolution,
          onProviderHealth: (event) =>
            recordProviderHealth({
              db,
              organizationId: input.organizationId,
              assistantTitle: assistant.title,
              event,
            }),
          // Live tier read (never snapshotted): missing row → watch (earned
          // nothing yet), read error → fail-open.
          getFlowTrust: (flowId) => readFlowTrustTier(db, assistant.id, flowId),
        });
        if (signal.aborted) {
          throw new DOMException("Conversation turn aborted", "AbortError");
        }
        // Handover continuation (#314): run the same message once inside the
        // target Assistant's latest Publication (one hop — the continuation's
        // own handover signal is ignored). Same-org guard: a flow can never
        // hand a Visitor to another tenant's assistant. Unpublished target or
        // any failure keeps the acknowledgement already streamed.
        if (result.handoverTo && result.handoverTo !== assistant.id) {
          try {
            const publication = await db.getLatestPublication(
              result.handoverTo
            );
            const targetConfig = publication?.config;
            if (
              targetConfig &&
              targetConfig.assistant.organizationId === input.organizationId
            ) {
              const target: Assistant = {
                ...targetConfig.assistant,
                createdAt: publication.createdAt,
                updatedAt: publication.createdAt,
              };
              const targetSearch: KnowledgeSearcher = async (query) => {
                const embedding = await embedText(query, input.connections, {
                  db,
                  organizationId: input.organizationId,
                  assistantId: target.id,
                  conversationId,
                });
                return db.searchChunks(target.id, null, {
                  embedding,
                  text: query,
                  limit: 6,
                });
              };
              const continuation = await runAssistantChat({
                assistant: target,
                platformPrompt,
                flows: targetConfig.flows,
                connections: input.connections,
                message,
                history,
                searchKnowledge: targetSearch,
                collectionId: null,
                session,
                alreadyClarified,
                skills: targetConfig.skills ?? [],
                // A handover does not move the visitor off the page they are
                // on: the target assistant's flows gate on the same facts.
                routing: {
                  url: conversation.metadata.launchUrl,
                  now: new Date(),
                },
                emit,
                signal,
                keyResolution: input.keyResolution,
              });
              result.parts.push(...continuation.parts);
              result.effects.push(...continuation.effects);
              result.usage.push(...continuation.usage);
              result.flowName = `${result.flowName} → ${target.title}: ${continuation.flowName}`;
            }
          } catch (error) {
            if (signal.aborted) throw error;
            console.error("[runtime] handover continuation failed:", error);
          }
        }
        const usage = summarizeTurnUsage(result.usage);
        await finishTurn({
          parts: result.parts,
          flowId: result.flowId,
          flowName: result.flowName,
          telemetry: {
            provider: usage.provider,
            modelId: usage.modelId,
            flowId: result.flowId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            toolCalls,
          },
          afterPersist: async (messageId) => {
            // Record the graph Retrieval Trace's QA id against this answer's
            // message id, so the feedback loop (#389) can score exactly the
            // graph elements that produced it. Persisted via the session bag
            // below (no schema change); only set when a graph search ran.
            if (graphQaId) {
              const existing = (session.get("graphQa") as Record<string, string>) ?? {};
              session.set("graphQa", { ...existing, [messageId]: graphQaId });
            }
            // AI usage ledger, written post-commit and isolated like session
            // state: losing accounting must never break the chat.
            await meterUsage(
              db,
              result.usage.map((u) => ({
                organizationId: input.organizationId,
                assistantId: assistant.id,
                conversationId,
                messageId,
                stage: u.stage,
                provider: u.provider,
                modelId: u.modelId,
                credentialKind: u.credentialKind,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
              }))
            );
            if (session.dirty) {
              // Persist after the reply so a failed turn never half-writes
              // state; isolated like effects — losing a memory must not break
              // the chat.
              try {
                await db.updateConversationSessionState(
                  conversationId,
                  session.snapshot()
                );
              } catch (error) {
                console.error("[runtime] session-state persist failed:", error);
              }
            }
            if (result.effects.length > 0) {
              await applyEffects(result.effects, {
                db,
                organizationId: input.organizationId,
                messageId,
              });
            }
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (!signal.aborted) {
          emit({ type: "error", message });
        }
        // Failures are never silent: the error outcome is recorded even when a
        // client-aborted turn suppresses the wire error event.
        await recordRuntimeEvent(db, {
          organizationId: input.organizationId,
          assistantId: assistant.id,
          conversationId,
          kind: "chat_turn",
          status: "failed",
          surface,
          durationMs: Date.now() - turnStart,
          toolCalls,
          errorClass: errorClassOf(error),
          errorMessage: message,
        });
      } finally {
        controller.close();
      }
    },
  });
}
