import type {
  Assistant,
  ConversationMetadata,
  ConversationSubject,
  EntitySnapshot,
  Flow,
  FlowTrigger,
  ProactiveTriggerContext,
  ProviderConnection,
  ReviewRequest,
  SkillSnapshot,
  StoredMessage,
  StoredTurnTrace,
  Teammate,
  TrustTier,
  FlowAction,
  WebhookSubscription,
} from "@agent-hub/core";
import {
  messageText,
  needsVisitorDeliveryHistory,
  notificationDelivery,
  proactiveFlowCandidates,
  reviewTemplateVariables,
  standingContextSections,
  teammateRuntimeAssistant,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import type {
  ChatReplyPart,
  ActionEffect,
  MemorySearcher,
  ReferralCandidate,
  TeammateActionTool,
} from "./types";
import { contactLabel } from "./actions";
import { summarizeTurnUsage } from "./usage";
import { recordRuntimeEvent, errorClassOf } from "./telemetry";
import { embedText } from "./embeddings";
import { buildKnowledgeSearcher } from "./retrieval";
import {
  runAssistantChat,
  runProactiveFlows,
  type HistoryMessage,
  type KnowledgeSearcher,
  type RuntimeEvent,
} from "./engine";
import { applyEffects, drainTurnEffects } from "./effects";
import { buildTemplateContext, platformAppOrigin } from "./template";
import { dbReviewRuntime, reviewPart } from "./review-runtime";
import { dbWebhookRuntime, webhookResumeVariables } from "./webhook-runtime";
import { createTurnSession } from "./session";
import { enqueueAgentMemoryJob, enqueueMemoryPromotionJob } from "./jobs";
import { MEMORY_RECALL_LIMIT } from "./memories";
import { prepareTraceForStorage } from "./trace";
import { createTurnObserver } from "./turn-observer";
import {
  executeTeammateAnswer,
  teammateMemorySections,
  type TeammateAnswerOutcome,
  type TeammateAnswerTurn,
} from "./teammate-answer";
import { recordProviderHealth } from "./health";
import { createDocumentReaderFactory } from "./knowledge-document-reader";
import {
  handoverTarget,
  mergeHandoverContinuation,
  runHandoverContinuation,
} from "./handover";
import {
  getEnterpriseCapabilities,
  type ActivationState,
} from "./ee";
import {
  admitAiSpend,
  CONVERSATION_SPEND_CAPACITY,
} from "./spend-admission";
import { isOperatorSurface, resolveChatModel, type KeyResolution } from "./models";
import { dbConnectorRuntime } from "./connector-request";
import type { EscalationDeskCandidate } from "./help-desk-recommend";
import { getRuntimeHost } from "./host";

/**
 * Conversation Turn (see context.md): one user message and everything the
 * runtime does to answer it, get-or-create the Conversation, persist the
 * user message, route through the flow engine, persist the assistant reply
 * with its flow markers, apply deferred effects, and stream ndjson
 * RuntimeEvents to the client.
 *
 * Both chat entrypoints are thin adapters over this seam: the Widget runs a
 * Publication snapshot for a Visitor, Preview runs live config for a Member.
 * The wire format (one JSON RuntimeEvent per line) lives only here.
 */
interface ConversationTurnBaseInput {
  /** Data access, already scoped by the caller (session db or widget db). */
  db: Db;
  /** Trusted server DB for cross-request leases, budgets, and outbox delivery. */
  systemDb?: Db;
  /**
   * The actions this Teammate was granted (#770), resolved by the host from its
   * grant rows and its ceiling. Each becomes a turn tool with a transcript
   * card; an empty list (the default, and the state of every ungranted
   * Teammate) registers nothing, and the turn can only talk.
   */
  teammateActions?: readonly TeammateActionTool[];
  /**
   * The colleagues this Teammate may refer the Member to (#773), resolved by
   * the host against the **Member's** visibility rather than the Teammate's:
   * a card naming something they cannot open is a dead end, and one naming a
   * private Teammate would disclose it. Empty registers no referral tool.
   */
  referralCandidates?: readonly ReferralCandidate[];
  /**
   * Standing context the host surface supplies for this one turn (#838): the
   * Flow Canvas hands the Flows Agent the open draft and the Assistant's
   * catalogue here. Rides the memory-document channel, above the transcript
   * and below the persona, so it is neither faked into a message nor stored.
   */
  standingContext?: readonly string[];
  /** Attached Skills, a Publication snapshot (widget) or live rows (preview). */
  skills?: SkillSnapshot[];
  /**
   * Selected shared Entities (#665): a Publication snapshot (widget) or
   * live rows (preview). Each yields auto-generated retrieval tools whose
   * Record content is always read live through `db`.
   */
  entities?: EntitySnapshot[];
  connections: ProviderConnection[];
  organizationId: string;
  /**
   * Who is speaking: a Visitor (widget), a Member (preview), or an SSO-signed
   * end-user ("sso", the widget gate verified them, #662).
   */
  subjectType: ConversationSubject;
  subjectId: string;
  /**
   * Verified SSO identity for "sso"-subject turns (#662): threaded from the
   * sealed gate cookie, never client- or model-supplied. Downstream per-user
   * capabilities (long-term memory, user-scoped records) key on it,
   * always together with the Organization, never on the subject alone.
   */
  verifiedIdentity?: {
    subjectId: string;
    claim?: { name: string; value: string };
  };
  /**
   * Conversation to continue. Reused only when it belongs to the same
   * subject and assistant; otherwise a fresh Conversation is started.
   */
  conversationId?: string | null;
  /** Knowledge Collection anchor, applied when a Conversation is created. */
  collectionId?: string | null;
  message: string;
  /** Stable client-generated id used to claim/replay this logical turn. */
  turnId?: string;
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
   * Surface context for provider resolution. Omit for published widget traffic.
   * The two internal surfaces name themselves (`preview`, `teammate`) and carry
   * the invoking Member, which is what lets that Member's own paired device run
   * their own turn and nobody else's (ADR-0007 as amended by #769). Hosted
   * subscription Provider Connections stay retired.
   */
  keyResolution?: KeyResolution;
  /**
   * The event that started this turn (#541). Absent or `"message"` is the
   * Visitor-message turn every existing caller runs. A proactive trigger
   * (`chat_open`, and later `page_load` / `time_on_page`) selects its flows by
   * the trigger instead of Intent Classification, persists no user message, and
   * calls no model, `message` is ignored and may be empty.
   */
  trigger?: FlowTrigger;
  /**
   * What the fired event knows about itself, today the dwell the client reports
   * for `time_on_page`. Re-checked against each flow's configured threshold, so a
   * short or replayed report cannot make a nudge fire early.
   */
  triggerContext?: ProactiveTriggerContext;
  /**
   * Continue this Conversation after a decided Human review (#841). A
   * system-initiated turn: no user message is persisted, the named Flow runs
   * from the action after the gate, and the reply is the next assistant
   * message. Pass a stable `turnId` so a retried job replays instead of
   * answering twice.
   */
  resumeReview?: ReviewRequest;
  /**
   * Continue this Conversation after a settled callback gate (#842). The same
   * system-initiated turn as `resumeReview`, and the same rules: no user
   * message is persisted, the named Flow runs from the action after the gate,
   * and a stable `turnId` makes a retried job replay instead of answering
   * twice. Only one of the two is ever set.
   */
  resumeWebhook?: WebhookSubscription;
}

/** A turn answered by an Assistant: a Publication snapshot or live rows. */
export interface AssistantTurnInput extends ConversationTurnBaseInput {
  /** Config the turn runs on. */
  assistant: Assistant;
  teammate?: undefined;
  /** Flows to route on. */
  flows: Flow[];
}

/**
 * A turn answered by an AI Teammate instead of an Assistant (#768).
 *
 * It brings three things the Assistant path does not have: the persona prompt
 * layer, a Knowledge Scope of Collections in place of an Assistant's linked
 * Sources, and a Conversation owned by the Teammate. Everything else, the
 * model resolution, the agent loop, the citations, is the same code, which is
 * the point: the product has one chat runtime, not two.
 *
 * No `flows` field: a Teammate has none, the runtime supplies its built-in
 * default. Making the field unassignable here is what stops a caller from
 * handing a Teammate an org's flows by accident.
 */
export interface TeammateTurnInput extends ConversationTurnBaseInput {
  teammate: Teammate;
  assistant?: undefined;
  flows?: undefined;
}

/**
 * One of the two turn kinds, exactly. The union (rather than two optional
 * fields and a runtime throw) makes "an Assistant or a Teammate, never both,
 * never neither" a fact the compiler checks at every call site.
 */
export type ConversationTurnInput = AssistantTurnInput | TeammateTurnInput;

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
 * read *error* stays fail-open (`null` → the engine changes nothing), absence of
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
 * Which credential kind this turn's chat model would run on, the same
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

function replayConversationTurn(
  conversationId: string,
  message: StoredMessage | null,
  running = false
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const emit = (event: RuntimeEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      emit({ type: "turn", conversationId });
      if (running) {
        emit({
          type: "error",
          message: "This message is already being processed. Retry shortly.",
        });
      } else if (!message) {
        emit({ type: "error", message: "The completed response could not be loaded." });
      } else {
        emit({
          type: "flow",
          flowId: message.flowId,
          flowName: message.flowName ?? "Completed turn",
          isDefault: false,
        });
        for (const part of message.content as ChatReplyPart[]) {
          if (part.type !== "tool_calls") emit({ type: "part", part });
        }
        emit({ type: "done", conversationId, messageId: message.id });
      }
      controller.close();
    },
  });
}

/**
 * Commits only this turn's session mutations through the Conversation version
 * fence. A conflict reloads the fence and retries the same database-side merge;
 * after repeated contention, the turn succeeds but emits an operational error
 * rather than overwriting a newer state snapshot.
 */
async function persistSessionPatch(
  db: Db,
  conversationId: string,
  initialVersion: number,
  patch: Record<string, unknown>
): Promise<void> {
  let expectedVersion = initialVersion;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (
      await db.mergeConversationSessionState({
        id: conversationId,
        expectedVersion,
        patch,
      })
    ) {
      return;
    }
    const latest = await db.getConversation(conversationId);
    if (!latest) throw new Error("Conversation disappeared during session update");
    expectedVersion = latest.sessionVersion;
  }
  throw new Error("Session update remained contended after 5 retries");
}

/**
 * The proactive half of the Conversation Turn (#541): a client event fired, so
 * the trigger selects the flows instead of Intent Classification.
 *
 * Three things make it cheaper than a message turn, and all three are load-bearing:
 * it resolves **no model** (a Notification is verbatim, so the turn is free and
 * meters nothing), it persists **no user message** (nobody spoke), and it touches
 * the database **only once it knows something will be delivered**, otherwise every
 * page view on a site with no proactive flows would mint a Conversation.
 *
 * The spend-based gates (daily budget, plan cap) do not apply to a turn that spends
 * nothing. Activation does: an organization that is not yet a customer should not be
 * messaging visitors unprompted.
 */
async function streamProactiveTurn(
  input: AssistantTurnInput & { trigger: FlowTrigger }
): Promise<ReadableStream<Uint8Array>> {
  const { db, assistant, subjectType, subjectId, signal, trigger } = input;
  const turnStart = Date.now();
  const surface =
    input.keyResolution?.surface === "preview" ? "preview" : "widget";

  const candidates = proactiveFlowCandidates(input.flows, trigger, {
    // The same objective facts the message funnel gates on (spec #550): the page
    // the event was reported from, and the clock. A proactive flow has no
    // conditions today, so this only matters if one is ever stored, better to
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
    // Refresh expects to see the nudge again, so the delivery rule, which exists
    // to protect a real Visitor from repetition, does not apply there.
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
        // not be recorded either, the Visitor can still receive it later.
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
            await persistSessionPatch(
              db,
              conversationId,
              conversation.sessionVersion,
              session.patch()
            );
          } catch (error) {
            console.error("[runtime] session-state persist failed:", error);
          }
        }
        if (result.effects.length > 0) {
          await applyEffects(result.effects, {
            db,
            organizationId: input.organizationId,
            conversationId,
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

/**
 * What kind of turn this is, decided once.
 *
 * Both kinds run the same engine over the same `Assistant`-shaped config, and
 * they differ in about a dozen small ways: which column owns the Conversation,
 * which surface the telemetry names, whether a persona layer exists, whether
 * flows come from the org or from one built-in, whether knowledge is searched
 * at all. Written as `teammate ? x : y` at each of those points, the shape of
 * the difference was invisible and every new one was another ternary in a
 * thousand-line function; three of them had already drifted into subtly
 * different conditions.
 *
 * So every pure decision about *kind* is taken here. Two places below still
 * branch on `teammate` because they need the row itself, not a decision about
 * it: the collection searcher wants its Knowledge Scope, and the memory read
 * wants its id. Those read a field first and use the row second.
 */
interface TurnSubject {
  /** The runtime config, whichever row it came from. */
  assistant: Assistant;
  /** The Teammate, when this is a Teammate turn (#768). */
  teammate: Teammate | null;
  /** Telemetry's name for where this turn happened (ADR-0011). */
  surface: "teammate" | "preview" | "widget";
  /**
   * Which Assistant the telemetry and usage rows point at. Null on a Teammate
   * turn: `assistant.id` is the Teammate's there, and writing it into a column
   * that references `assistants` is a dangling reference, not an attribution.
   */
  attributedAssistantId: string | null;
  /** Exactly one owner column for a new Conversation (#768). */
  conversationOwner: { teammateId: string } | { assistantId: string };
  /**
   * The configured Flows for an Assistant. An AI Teammate's implicit Flow is
   * owned by the shared answer module and this list stays empty.
   */
  flows: Flow[];
  /**
   * Whether the API catalogue triad (#559) can be registered. An integration
   * belongs to an Assistant, and a Teammate is not one.
   */
  hasApiCatalogue: boolean;
  /**
   * Whether the windowed document reader is registered. It checks tenancy
   * through the Assistant's linked Sources, which a Teammate turn has no
   * equivalent of yet, so a Teammate cites what it searched and reads no
   * further.
   */
  readsKnowledgeDocuments: boolean;
  /**
   * Whether per-flow trust tiers are graded. A Teammate's implicit flow has no
   * ledger and no escalation ramp to offer.
   */
  gradesFlowTrust: boolean;
}

function resolveTurnSubject(input: ConversationTurnInput): TurnSubject {
  if (input.teammate) {
    const teammate = input.teammate;
    return {
      // One config shape for both kinds of turn: a Teammate projects onto it
      // (`teammateRuntimeAssistant`), an Assistant already is it.
      assistant: teammateRuntimeAssistant(teammate),
      teammate,
      surface: "teammate",
      attributedAssistantId: null,
      conversationOwner: { teammateId: teammate.id },
      flows: [],
      hasApiCatalogue: false,
      readsKnowledgeDocuments: false,
      gradesFlowTrust: false,
    };
  }
  const assistant = input.assistant;
  return {
    assistant,
    teammate: null,
    // Internal chat is its own surface, so telemetry can tell staff usage from
    // a Visitor's and from an admin testing in the Preview (#768).
    surface: input.keyResolution?.surface === "preview" ? "preview" : "widget",
    attributedAssistantId: assistant.id,
    conversationOwner: { assistantId: assistant.id },
    flows: input.flows,
    // Grounding is an ADR-0002 invariant for an Assistant.
    hasApiCatalogue: true,
    readsKnowledgeDocuments: true,
    gradesFlowTrust: true,
  };
}

/** Whether this Conversation belongs to the thing answering this turn. */
function ownsConversation(
  subject: TurnSubject,
  conversation: { assistantId?: string | null; teammateId?: string | null }
): boolean {
  return subject.teammate
    ? conversation.teammateId === subject.teammate.id
    : conversation.assistantId === subject.assistant.id;
}

/**
 * The assistant messages persisted after the Visitor's last one: what a closed
 * Human review wrote while nobody was in the chat (#841). Empty in the common
 * case, where the newest stored message is the Visitor's own.
 */
function trailingAssistantParts(stored: readonly StoredMessage[]): ChatReplyPart[] {
  const parts: ChatReplyPart[] = [];
  for (let i = stored.length - 1; i >= 0; i -= 1) {
    const message = stored[i]!;
    if (message.role !== "assistant") break;
    parts.unshift(
      ...(message.content as ChatReplyPart[]).filter((part) => part.type !== "tool_calls")
    );
  }
  return parts;
}

export async function streamConversationTurn(
  input: ConversationTurnInput
): Promise<ReadableStream<Uint8Array>> {
  const { db, message, subjectType, subjectId, signal } = input;
  const systemDb = input.systemDb ?? db;
  const subject = resolveTurnSubject(input);
  const { assistant, teammate, attributedAssistantId } = subject;

  // A proactive trigger takes the same seam but a different path: no
  // classification, no model, no user message (#541). Teammates have no
  // proactive triggers: nothing fires a page-load event inside the console.
  const trigger = input.trigger ?? "message";
  if (trigger !== "message") {
    // Teammates have no proactive triggers: nothing fires a page-load event
    // inside the console, and a Teammate turn carries no flows to select from.
    if (input.teammate) return silentTurn();
    return streamProactiveTurn({ ...input, trigger });
  }

  // Runtime telemetry (ADR-0011): one `chat_turn` event per turn, attributed
  // to org/assistant/conversation and stamped with latency, tokens, tool
  // calls, and error outcome. Written post-commit and fire-safe, so the sink
  // never breaks or slows a user-visible turn.
  const turnStart = Date.now();
  const surface = subject.surface;
  const suppliedTurnId = input.turnId?.trim();
  if (suppliedTurnId && !/^[A-Za-z0-9_-]{1,100}$/.test(suppliedTurnId)) {
    throw new Error("Invalid turn id");
  }
  const requestId = suppliedTurnId || crypto.randomUUID();

  const connectionKind = turnConnectionKind(
    assistant,
    input.connections,
    input.keyResolution
  );
  // Long-term memory applies only to SSO-signed subjects (#664); derived up
  // front so the toggle read can join the parallel gate wave below.
  const memorySubjectId =
    subjectType === "sso" && input.verifiedIdentity
      ? input.verifiedIdentity.subjectId
      : null;

  // The pre-stream gates and static config reads have no data dependencies on
  // each other, so they run as ONE parallel wave, every await removed here is
  // wall-clock the Visitor spends staring at a closed stream. Each member
  // keeps its own fail-open semantics:
  //
  // - Budget (notify mode only raises/resolves the Alert; block mode answers
  //   with a fixed unavailable reply below, the exchange still persists, a
  //   Visitor is never silently dropped).
  // - Plan-cap gate (#442): whether platform-funded traffic may still run this
  //   month. OSS default allows everything; BYOK turns are never blocked.
  // - Organization activation (#444): whether this org may run at all, applies
  //   to BYOK too (a pending organization is not yet a customer). Self-hosted
  //   deployments never see it.
  // - The API catalogue integration (spec #559): the toolset has to know
  //   whether an integration exists before the model runs; a read failure
  //   leaves the catalogue tools unregistered rather than failing the turn.
  // - The org memory toggle (#664), read only for SSO subjects; fails open to
  //   "off", memory problems must never take the assistant down.
  const [loadedConversation, apiIntegration, platformPrompt, memoryEnabled] =
    await Promise.all([
    input.conversationId
      ? db.getConversation(input.conversationId)
      : Promise.resolve(null),
    // The API catalogue is an Assistant integration (spec #559); a Teammate
    // has none, so the tools stay unregistered rather than querying for an id
    // that belongs to a different table.
    subject.hasApiCatalogue
      ? db.getApiIntegration(assistant.id).catch(() => null)
      : Promise.resolve(null),
    // The immutable platform (Ciele) prompt layer, same for every org.
    getRuntimeHost().getPlatformSystemPrompt(),
    memorySubjectId
      ? db.getMemoryEnabled(input.organizationId).catch(() => false)
      : Promise.resolve(false),
    ]);

  let conversation = loadedConversation;
  if (
    conversation &&
    (conversation.subjectType !== subjectType ||
      conversation.subjectId !== subjectId ||
      !ownsConversation(subject, conversation))
  ) {
    conversation = null;
  }
  if (!conversation) {
    const ownerId = teammate?.id ?? assistant.id;
    conversation = await db.createConversation({
      ...(input.turnId ? { id: `turn_${ownerId}_${requestId}` } : {}),
      // Exactly one owner (#768): the Teammate, or the Assistant.
      ...subject.conversationOwner,
      subjectType,
      subjectId,
      collectionId: input.collectionId ?? null,
      title: message.slice(0, 80) || "Conversation",
      metadata: input.metadata,
    });
  }
  if (
    conversation.subjectType !== subjectType ||
    conversation.subjectId !== subjectId ||
    !ownsConversation(subject, conversation)
  ) {
    throw new Error("Stable turn id collided with an inaccessible conversation");
  }

  const claimNow = new Date();
  const turnClaim = await systemDb.claimConversationTurn({
    conversationId: conversation.id,
    requestId,
    workerId: crypto.randomUUID(),
    now: claimNow.toISOString(),
    staleBefore: new Date(claimNow.getTime() - 10 * 60_000).toISOString(),
  });
  if (turnClaim.status === "running") {
    return replayConversationTurn(conversation.id, null, true);
  }
  if (turnClaim.status === "completed") {
    const completed = turnClaim.assistantMessageId
      ? await db.getMessage(turnClaim.assistantMessageId)
      : null;
    return replayConversationTurn(conversation.id, completed);
  }
  const turnLeaseToken = turnClaim.leaseToken;

  const collectionId = input.collectionId ?? conversation.collectionId ?? null;
  // The one retrieval port: embedding + vector + the Knowledge Engine choice
  // (ADR-0017, Graph primary, vector same-call fallback) live behind
  // buildKnowledgeSearcher, the same factory every other retrieval caller
  // uses. The graph QA id for this turn is captured for the feedback
  // substrate (#389).
  let graphQaId: string | null = null;
  /**
   * A Teammate with an empty Knowledge Scope gets NO searcher, which is what
   * leaves the tool unregistered downstream (`buildToolset`): a pure-persona
   * Teammate must not be handed a search that always comes back empty, or it
   * spends the turn calling it (#768).
   */
  const searchKnowledge: KnowledgeSearcher | undefined = teammate
    ? undefined
    : buildKnowledgeSearcher({
        db,
        connections: input.connections,
        assistant,
        collectionId,
        conversationId: conversation.id,
        onTrace: (qaId) => {
          graphQaId = qaId;
        },
      });

  const stored = await db.listRecentMessages(
    conversation.id,
    RECENT_HISTORY_LIMIT
  );

  // Long-term memory (#664): the org toggle was read in the gate wave above;
  // the searcher exists only for enabled SSO subjects.
  let searchMemories: MemorySearcher | undefined;
  let longTermMemory: string[] | undefined;
  if (memoryEnabled && memorySubjectId) {
    searchMemories = async (query: string) => {
      const embedding = await embedText(query, input.connections, {
        db,
        organizationId: input.organizationId,
        assistantId: attributedAssistantId,
        conversationId: conversation!.id,
      });
      return db.searchMemories({
        organizationId: input.organizationId,
        subjectId: memorySubjectId,
      }, {
        embedding,
        text: query,
        limit: MEMORY_RECALL_LIMIT,
      });
    };
  }
  /**
   * The windowed knowledge reader (spec #559): a search returns the matching
   * chunk, this returns the whole document behind it so the model can walk it
   * by character range. The widget's Db is service-role (it bypasses RLS by
   * design), so the tenancy check on a model-supplied id is what keeps a
   * Visitor's turn inside its own Assistant, see
   * knowledge-document-reader.ts.
   */
  const documentReaderFor = createDocumentReaderFactory(db);
  const readKnowledgeDocument = subject.readsKnowledgeDocuments
    ? documentReaderFor(assistant.id)
    : undefined;

  /**
   * The three memory layers (#771), read fresh each turn like the rest of a
   * Teammate's configuration: an edit in settings lands on the next message,
   * and so does a Project being archived.
   *
   * All three reads are best-effort. Memory is an enrichment, and a turn that
   * answers without it is worse than one that answers with it but far better
   * than one that fails; the same fail-open rule long-term memory already has.
   */
  const memoryDocuments = teammate
    ? // A referral's summary is standing context for this conversation, not a
      // message: it is neither the Member's words nor this Teammate's, so it
      // rides the same channel as the memory layers rather than being faked
      // into the transcript as something somebody said (#773).
      standingContextSections(
        await teammateMemorySections(db, {
          teammate,
          memberId: subjectId,
        }).catch((error) => {
          console.error("[runtime] memory-document read failed:", error);
          return [] as string[];
        }),
        conversation.metadata
      ).concat(input.standingContext ?? [])
    : undefined;

  // Tau-style session: the conversation's persistent state bag, exposed to
  // tools for this turn and written back below only if something changed.
  const session = createTurnSession(conversation.id, conversation.sessionState);
  const clarifyQuestion = (content: readonly unknown[]): string | null => {
    for (const part of content) {
      const p = part as { type?: string; question?: string };
      if (p?.type === "clarify") return p.question ?? "";
    }
    return null;
  };
  // A clarification is persisted as a `clarify` part with no text part, so
  // `messageText` flattens it to "", which would hand the model an empty
  // assistant turn and hide from the courtesy detector that a question was
  // asked (#566). Recovered here rather than by widening `messageText`, whose
  // "text parts only" contract every other consumer relies on.
  const history: HistoryMessage[] = stored.map((m) => {
    const text = messageText(m.content);
    if (text || m.role !== "assistant") return { role: m.role, text };
    const question = clarifyQuestion(m.content);
    return question === null
      ? { role: m.role, text }
      : { role: m.role, text: question, askedQuestion: true };
  });
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

  // The user-message persist and the first-turn memory recall (the top-k
  // memories relevant to the opening message become the "Long-term memory"
  // prompt block; later turns rely on the searchMemories tool) are
  // independent, one wave, not two awaits.
  await Promise.all([
    // A resumed turn has no Visitor words to persist (#841, #842).
    input.resumeReview || input.resumeWebhook
      ? Promise.resolve()
      : db.appendMessage({
          conversationId: conversation.id,
          requestId,
          role: "user",
          content: [{ type: "text", text: message }],
        }),
    (async () => {
      if (!searchMemories || stored.length !== 0) return;
      try {
        const recalled = await searchMemories(message);
        if (recalled.length > 0) longTermMemory = recalled.map((r) => r.text);
      } catch (error) {
        console.error("[runtime] long-term memory recall failed:", error);
      }
    })(),
  ]);

  const spendAdmission = await admitAiSpend({
    db,
    organizationId: input.organizationId,
    connectionKinds: connectionKind ? [connectionKind] : [],
    capacity: CONVERSATION_SPEND_CAPACITY,
  });

  const conversationId = conversation.id;
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const forward = (event: RuntimeEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const observer = createTurnObserver(forward);
      const emit = observer.emit;
      emit({ type: "turn", conversationId });
      // A Human review closed while the Visitor was away (#841): the outcome
      // was persisted as an assistant message after their last one, and this
      // live transcript never saw it. Replay those parts at the top of this
      // turn's stream, emitted only, never persisted twice; the Visitor's new
      // message is what makes them no longer trailing next time.
      if (!input.resumeReview && !input.resumeWebhook) {
        for (const part of trailingAssistantParts(stored)) emit({ type: "part", part });
      }
      /**
       * The one terminal-turn ritual, persist the assistant message, run any
       * post-persist bookkeeping, emit `done`, record the `chat_turn`
       * telemetry. Every successful path (budget-block, FAQ quick reply,
       * normal completion) ends here, so the persistence/telemetry contract
       * has a single home.
       */
      const finishTurn = async (turn: {
        parts: ChatReplyPart[];
        flowId: string | null;
        flowName: string;
        effects?: ActionEffect[];
        /** Extra telemetry fields (usage, toolCalls, flowId) beyond the base. */
        telemetry?: Partial<Parameters<typeof recordRuntimeEvent>[1]>;
        /** A shared Teammate lifecycle already folded these public events. */
        observation?: {
          trace: StoredTurnTrace | null;
          partsAreAudited: boolean;
        };
        /** Shared lifecycle owns the Teammate telemetry payload. */
        recordTelemetry?: (messageId: string) => Promise<void>;
        /** Bookkeeping between persist and `done` (usage ledger, session, effects). */
        afterPersist?: (messageId: string) => Promise<void>;
      }): Promise<void> => {
        // The audit part is persistence-only: never emitted on the wire (the
        // live Thinking panel already streamed each call).
        const parts = turn.observation?.partsAreAudited
          ? turn.parts
          : observer.partsWithAudit(turn.parts);
        const storedTrace =
          turn.observation?.trace ?? prepareTraceForStorage(observer.trace);
        const saved = turnLeaseToken
          ? await systemDb.commitConversationTurn({
              conversationId,
              requestId,
              leaseToken: turnLeaseToken,
              content: parts,
              flowId: turn.flowId,
              flowName: turn.flowName,
              // Null for a turn that did no agentic work (a verbatim message, a
              // proactive Notification, a pre-engine gate), see trace.ts.
              trace: storedTrace,
              deferredEffects: turn.effects,
              now: new Date().toISOString(),
            })
          : await db.appendMessage({
              conversationId,
              role: "assistant",
              content: parts,
              flowId: turn.flowId,
              flowName: turn.flowName,
              trace: storedTrace,
            });
        if (!saved) {
          throw new Error("Conversation turn lease was superseded before commit");
        }
        emit({ type: "done", conversationId, messageId: saved.id });
        await turn.afterPersist?.(saved.id);
        if (turnLeaseToken) {
          await drainTurnEffects(systemDb, { messageId: saved.id }).catch((error) =>
            console.error("[effects] deferred drain failed:", error)
          );
        } else if (turn.effects && turn.effects.length > 0) {
          await applyEffects(turn.effects, {
            db,
            organizationId: input.organizationId,
            conversationId,
            messageId: saved.id,
          });
        }
        if (turn.recordTelemetry) {
          await turn.recordTelemetry(saved.id);
        } else {
          await recordRuntimeEvent(db, {
            organizationId: input.organizationId,
            assistantId: attributedAssistantId,
            conversationId,
            messageId: saved.id,
            kind: "chat_turn",
            status: "succeeded",
            surface,
            flowName: turn.flowName,
            durationMs: Date.now() - turnStart,
            ...turn.telemetry,
          });
        }
      };
      /**
       * A pre-engine gate's fixed reply: skip every model call, answer with
       * neutral copy plus the escalation offer, and persist the exchange like
       * any turn, a Visitor is never silently dropped.
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
      let teammateFailureRecorded = false;
      try {
        if (spendAdmission.blocked?.reason === "budget") {
          // Hard daily-budget ceiling.
          await gatedReply(
            "Budget limit",
            "The assistant has reached its daily usage limit and will be back soon. For anything urgent, please contact support."
          );
          return;
        }
        if (spendAdmission.blocked?.reason === "activation") {
          // No model call, no credential handed out, the organization is not
          // active yet. Everything they configured is untouched; activating
          // them makes the same assistant answer.
          await gatedReply("Pending activation", spendAdmission.blocked.detail);
          return;
        }
        if (spendAdmission.blocked?.reason === "usage") {
          // Plan cap reached (#442): platform-funded traffic pauses with a
          // graceful reply; the enterprise capability wrote the admin-facing
          // upgrade prompt as an Alert.
          await gatedReply("Usage limit", spendAdmission.blocked.detail);
          return;
        }
        // FAQ quick reply: answer with the curated FAQ body verbatim, no
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
        const turnOperationKey = `conversation-turn/${conversationId}/${requestId}`;
        const answerTurn = {
          effectKeyPrefix: turnOperationKey,
          platformPrompt,
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
          // Conversation was launched from (spec #550): captured once at
          // launch, so mid-conversation navigation is not re-evaluated.
          routing: {
            url: conversation.metadata.launchUrl,
            now: new Date(),
          },
          readKnowledgeDocument,
          apiIntegration,
          teammateActions: input.teammateActions,
          memoryDocuments,
          referralCandidates: input.referralCandidates,
          collectionId,
          session,
          alreadyClarified,
          skills: input.skills,
          longTermMemory,
          searchMemories,
          // Entity tools (#665): the tool SET comes from the snapshot/live
          // config; Record CONTENT reads live through the turn's db.
          entities: input.entities,
          queryEntityRecords: (entityId, query) =>
            db.queryEntityRecords(entityId, query),
          // Connector actions (#839) read the Connection live and may mark it
          // for reauthorization; a personal Connection is allowed only on the
          // operator surfaces, the same line ADR-0007 draws for provider keys.
          connectorRuntime: dbConnectorRuntime(db, assistant.organizationId, {
            allowPersonal: isOperatorSurface(input.keyResolution ?? {}),
            memberId: input.keyResolution?.memberId ?? null,
          }),
          // The Human review gate (#841): raises its request against this
          // Conversation; simulated on the operator surfaces, where nobody is
          // notified and the transcript decides inline.
          // Bound to the system Db: the review table has no member insert
          // policy, the runtime is its only writer. A Teammate turn has no
          // Flows, so it never reaches the gate.
          reviewRuntime: teammate
            ? undefined
            : dbReviewRuntime(systemDb, {
                conversation,
                assistant,
                simulated: isOperatorSurface(input.keyResolution ?? {}),
              }),
          webhookRuntime: teammate
            ? undefined
            : dbWebhookRuntime(systemDb, {
                conversation,
                assistant,
                simulated: isOperatorSurface(input.keyResolution ?? {}),
              }),
          resumeFrom: resumeCursor(input, input.flows ?? []),
          // Entity tool policy input (#667): the verified subject type and
          // claim decide which tool variants exist, never the model.
          toolSubject: {
            type: subjectType,
            subjectId: input.verifiedIdentity?.subjectId ?? null,
            claimValue: input.verifiedIdentity?.claim?.value ?? null,
          },
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
          // nothing yet), read error → fail-open. A Teammate's implicit flow
          // has no ledger and no escalation ramp to offer, so it is not graded.
          getFlowTrust: subject.gradesFlowTrust
            ? (flowId) => readFlowTrustTier(db, assistant.id, flowId)
            : undefined,
        } satisfies TeammateAnswerTurn;
        let teammateExecution: Extract<
          TeammateAnswerOutcome,
          { ok: true }
        > | null = null;
        let result: Awaited<ReturnType<typeof runAssistantChat>>;
        if (teammate) {
          const outcome = await executeTeammateAnswer({
              db,
              organizationId: input.organizationId,
              teammate,
              connections: input.connections,
              conversationId,
              turn: answerTurn,
              forward,
              telemetry: {
                assistantId: attributedAssistantId,
                conversationId,
                surface: "teammate",
                startedAt: turnStart,
              },
            });
          if (!outcome.ok) {
            await outcome.recordFailed();
            teammateFailureRecorded = true;
            throw outcome.error;
          }
          teammateExecution = outcome;
          result = outcome.result;
        } else {
          result = await runAssistantChat({
              ...answerTurn,
              assistant,
              flows: subject.flows,
              connections: input.connections,
              searchKnowledge,
            });
        }
        if (signal.aborted) {
          throw new DOMException("Conversation turn aborted", "AbortError");
        }
        // A resumed review turn opens with the gate's closed card (#841), so
        // the transcript, the widget and the Inbox all show how it closed.
        if (input.resumeReview) {
          const closed = reviewPart(input.resumeReview);
          emit({ type: "part", part: closed });
          result = { ...result, parts: [closed, ...result.parts] };
        }
        // Handover continuation (#314): the same message, run once more
        // inside the target Assistant's Publication. One hop, same
        // Organization only, and any failure keeps the acknowledgement
        // already streamed (handover.ts).
        const handoverTo = teammate ? null : handoverTarget(result, assistant.id);
        if (handoverTo) {
          const continuation = await runHandoverContinuation({
            db,
            connections: input.connections,
            platformPrompt,
            targetId: handoverTo,
            organizationId: input.organizationId,
            message,
            history,
            conversationId,
            launchUrl: conversation.metadata.launchUrl,
            session,
            alreadyClarified,
            readKnowledgeDocumentFor: documentReaderFor,
            emit,
            signal,
            keyResolution: input.keyResolution,
            effectKeyPrefix: turnOperationKey,
          });
          if (continuation) {
            result = mergeHandoverContinuation(result, continuation);
          }
        }
        const usage = summarizeTurnUsage(result.usage);
        await finishTurn({
          parts: teammateExecution?.parts ?? result.parts,
          flowId: result.flowId,
          flowName: result.flowName,
          effects: result.effects,
          observation: teammateExecution
            ? { trace: teammateExecution.trace, partsAreAudited: true }
            : undefined,
          recordTelemetry: teammateExecution
            ? (messageId) => teammateExecution.recordSucceeded(messageId)
            : undefined,
          telemetry: {
            provider: usage.provider,
            modelId: usage.modelId,
            flowId: result.flowId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            toolCalls: teammateExecution?.toolCalls ?? observer.toolCalls,
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
            const usageRows = teammateExecution
              ? teammateExecution.usageRows(messageId)
              : result.usage.map((u) => ({
                organizationId: input.organizationId,
                assistantId: attributedAssistantId,
                conversationId,
                messageId,
                stage: u.stage,
                provider: u.provider,
                modelId: u.modelId,
                credentialKind: u.credentialKind,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
              }));
            await spendAdmission.settle(usageRows);
            if (session.dirty) {
              // Persist after the reply so a failed turn never half-writes
              // state; isolated like effects, losing a memory must not break
              // the chat.
              try {
                await persistSessionPatch(
                  db,
                  conversationId,
                  conversation.sessionVersion,
                  session.patch()
                );
              } catch (error) {
                console.error("[runtime] session-state persist failed:", error);
              }
            }
            // Memory promotion (#664): enqueue the durable extraction job,
            // due once the conversation goes quiet, background only, so a
            // failure to enqueue never breaks the chat.
            if (memoryEnabled && memorySubjectId) {
              try {
                await enqueueMemoryPromotionJob(
                  {
                    conversationId,
                    organizationId: input.organizationId,
                  },
                  { db }
                );
              } catch (error) {
                console.error("[runtime] memory-promotion enqueue failed:", error);
              }
            }
            // The Agent layer (#771): what this Teammate learned about doing
            // its job. Unconditional on a Teammate turn, because the decision
            // about whether anything was worth keeping belongs to the
            // distiller, which usually says no. Same durable-row-first shape,
            // and a failure to enqueue never breaks the chat.
            if (teammate) {
              try {
                await enqueueAgentMemoryJob(
                  {
                    organizationId: input.organizationId,
                    teammateId: teammate.id,
                    conversationId,
                  },
                  { db }
                );
              } catch (error) {
                console.error("[runtime] agent-memory enqueue failed:", error);
              }
            }
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (!signal.aborted) {
          emit({ type: "error", message });
        }
        if (turnLeaseToken) {
          await systemDb
            .failConversationTurn({
              conversationId,
              requestId,
              leaseToken: turnLeaseToken,
              error: message,
              now: new Date().toISOString(),
            })
            .catch(() => false);
        }
        // Failures are never silent: the error outcome is recorded even when a
        // client-aborted turn suppresses the wire error event.
        if (!teammateFailureRecorded) {
          await recordRuntimeEvent(db, {
            organizationId: input.organizationId,
            assistantId: attributedAssistantId,
            conversationId,
            kind: "chat_turn",
            status: "failed",
            surface,
            durationMs: Date.now() - turnStart,
            toolCalls: observer.toolCalls,
            errorClass: errorClassOf(error),
            errorMessage: message,
          });
        }
      } finally {
        await spendAdmission.release();
        controller.close();
      }
    },
  });
}

/**
 * Where a resumed turn picks the Flow back up (#841, #842).
 *
 * Two gates, one cursor. Both stop a Flow mid-chain and both continue from the
 * action after the one that stopped it, so they share the engine's resume seam
 * rather than each teaching it about themselves. The `action` is part of the
 * cursor because the engine re-checks it against the live Flow: an index into
 * a chain that was edited during the wait would otherwise run whatever now
 * sits in that slot.
 */
function resumeCursor(
  input: { resumeReview?: ReviewRequest; resumeWebhook?: WebhookSubscription },
  flows: Flow[]
): { flowId: string; actionIndex: number; action: FlowAction; templatePatch: Record<string, string> } | undefined {
  if (input.resumeReview) {
    return {
      flowId: input.resumeReview.flowId,
      actionIndex: input.resumeReview.actionIndex,
      action: "human_review",
      templatePatch: reviewTemplateVariables(input.resumeReview),
    };
  }
  if (input.resumeWebhook) {
    const settings = flows.find((flow) => flow.id === input.resumeWebhook!.flowId)
      ?.actionSettings?.http_webhook;
    return {
      flowId: input.resumeWebhook.flowId,
      actionIndex: input.resumeWebhook.actionIndex,
      action: "http_webhook",
      templatePatch: webhookResumeVariables(input.resumeWebhook, settings),
    };
  }
  return undefined;
}

/**
 * The Teammate's three memory documents, rendered into prompt sections (#771).
 *
 * Read here rather than handed in by the host, because the runtime already
 * holds the Teammate and the Db and this is a fact about the turn, not about
 * the surface that started it. Which layers exist is a domain rule
 * (`memoryPromptSections`), including the one that matters most: all three
 * empty means nothing is injected at all, not three empty headings.
 */
