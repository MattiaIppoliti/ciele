import type { LanguageModel } from "ai";
import type {
  AiCredentialKind,
  AiUsageStage,
  ApiIntegration,
  Assistant,
  ConversationSubject,
  EntityRecord,
  EntityRecordQuery,
  EntitySnapshot,
  Flow,
  FlowAction,
  FlowButtonIcon,
  KnowledgeSearchResult,
  Provider,
  SkillSnapshot,
} from "@agent-hub/core";
import type { TurnSession } from "./session";
import type { TemplateContext } from "./template";

/**
 * One renderable piece of a bot reply, tagged with the action that produced
 * it. The runtime's client-facing output contract (spec #194): it flows
 * through the RuntimeEvent `part` event and is what Widget, Preview, and
 * Inbox render. Owned here — the data package's engine is routing-only.
 */
export type ChatReplyPart =
  /**
   * `fallback` = error/limit copy; `refusal` = the model declined on safety
   * grounds (persisted, queryable marker — never a knowledge gap).
   */
  | { type: "text"; action: FlowAction | "fallback" | "refusal"; text: string }
  | {
      type: "help_desk";
      action: "suggest_help_desk" | "show_button";
      label: string;
      helpDeskId?: string;
      showIcon?: boolean;
      icon?: FlowButtonIcon;
    }
  | { type: "follow_ups"; action: "follow_up_questions"; questions: string[] }
  /**
   * Tool-call audit trail (#665): the turn's instrumented tool calls,
   * persisted with the assistant message so the Inbox transcript shows how
   * the answer was produced. Appended by the Conversation Turn from the
   * tool-start/tool-end lifecycle events; the widget renders nothing for it
   * (the live Thinking panel is its surface).
   */
  | {
      type: "tool_calls";
      calls: Array<{ tool: string; label: string; ok: boolean; summary?: string }>;
    }
  | {
      type: "button";
      /** `notification` when the button came from a proactive nudge (#544). */
      action: "show_button" | "notification";
      label: string;
      buttonType: "external_link" | "send_text" | "faq";
      url?: string;
      text?: string;
      showIcon?: boolean;
      icon?: FlowButtonIcon;
    }
  | {
      type: "iframe";
      action: "iframe";
      url: string;
      title?: string;
      lightbox?: boolean;
      height?: number;
      heightUnit?: "vh" | "px";
    }
  /**
   * Agentic Search terminal clarify (spec #61 / #156): instead of guessing or
   * dead-ending, the assistant asks one focused question. Emitted when query
   * understanding can't resolve the message into a searchable intent
   * (pre-search) or every pass came back empty/conflicting (post-search).
   * `found` is a short, optional "here's what I *did* surface" list so a
   * dead-end still frames what is known vs. missing. Terminal for the turn's
   * generative work; the anti-loop guardrail emits at most one per turn and
   * never re-clarifies a message already clarified in the conversation.
   */
  | {
      type: "clarify";
      action: "search_knowledge";
      question: string;
      found?: string[];
    }
  /**
   * A proactive nudge from a Flow whose trigger was a client event rather than a
   * Visitor message (#541). Verbatim, like `custom_message` — the runtime never
   * rewrites it, and producing one costs no model call.
   */
  | {
      type: "notification";
      action: "notification";
      /** Optional heading rendered above the content. */
      title?: string;
      content: string;
      /**
       * Set to false when the flow made the nudge one-way: the chat disables its
       * composer and says so, rather than letting the Visitor type into a dead
       * end. Absent means replies are allowed.
       */
      allowReplies?: boolean;
    }
  /**
   * Simplified thinking (#560): one short, user-facing line per tool phase, in
   * the Visitor's language, saying what the assistant is about to do. Produced
   * by the model as the `progress` argument of the tool call it is about to
   * make, so it costs no extra model call and always describes the phase that
   * actually ran.
   *
   * A part rather than a prefix on the answer text (which is what the reference
   * platform does): same rendering, but still separable afterwards for the
   * transcript, the export and analytics.
   *
   * `action` names the tool phase the line narrated: `search_knowledge` for the
   * knowledge search, otherwise the registry tool name (`queryApi`,
   * `readKnowledgeSource`, …). Parts persisted before the identity was carried
   * (#576) all say `search_knowledge`; rendering never discriminates on it.
   */
  | { type: "progress"; action: string; text: string }
  | {
      type: "sources";
      action: "search_knowledge";
      sources: Array<{
        /** Concept behind the citation — lets the verifier re-fetch content. */
        conceptId?: string;
        conceptTitle: string;
        collectionName: string;
        sourceName: string | null;
        /** Original page/document URL — the chip links out when present. */
        url?: string | null;
      }>;
    };

/**
 * Which knowledge-scope tier a search pass targets (Agentic Search #155).
 * - `collection` (default) — the anchored Knowledge Collection only.
 * - `assistant`  — assistant-wide knowledge; drops the collection filter.
 * When no Collection is anchored the two tiers coincide.
 */
export type SearchScope = "collection" | "assistant";

/**
 * RAG search over the assistant's knowledge; null-embedding falls back to
 * lexical. The optional `scope` selects the retrieval tier: absent/`collection`
 * keeps the turn's anchored Knowledge Collection filter, `assistant` widens to
 * assistant-wide knowledge (the reformulation scope-tier widen, #155). The
 * search implementation already treats a null collection as assistant-wide.
 */
export type KnowledgeSearcher = (
  query: string,
  options?: { scope?: SearchScope }
) => Promise<KnowledgeSearchResult[]>;

/**
 * One knowledge document read whole, for the windowed `readKnowledgeSource`
 * tool (spec #559). A search returns the matching *chunk*; this is the document
 * that chunk came from, so the model can walk it by character range instead of
 * being handed a chunk cut off mid-answer with no way to ask for more.
 */
export interface KnowledgeDocument {
  id: string;
  title: string;
  /** The Source the document belongs to, for the reader's own citation line. */
  sourceName: string | null;
  text: string;
}

/**
 * A Thinking Step, owned by the domain package because it is persisted with the
 * answer it explains (ADR-0019); re-exported here so the wire contract reads in
 * one place. {@link StepStage} comes with it for the legacy `kind: "step"` rows
 * traces persisted before the phase machine was retired still hold (#560).
 */
export type { StepStage, TurnStep } from "@agent-hub/core";

/** Wire events streamed to the chat client (ndjson). */
export type RuntimeEvent =
  | { type: "turn"; conversationId: string }
  | { type: "flow"; flowId: string | null; flowName: string; isDefault: boolean }
  /**
   * A runtime diagnostic worth telling an operator about: the flow that matched,
   * a provider fallback, an API response that would not parse. `detail` is an
   * optional expandable annotation ("Model: gpt-4o-mini").
   *
   * Replaces the retired `step` event (#560). A notice states a fact the runtime
   * observed; the phase labels it replaced ("Deciding what to do…") only
   * described where the loop was, which the tool lifecycle now shows directly.
   */
  | { type: "notice"; label: string; detail?: string }
  /**
   * Tool-invocation lifecycle start. `callId` pairs it with its `tool-end`;
   * `input` is the model-supplied arguments, already safe to show (query
   * strings, URLs — never secrets, which live server-side only).
   */
  | {
      type: "tool-start";
      callId: string;
      tool: string;
      label: string;
      input?: Record<string, unknown>;
      /**
       * Which agent-loop iteration this call spent (#558). Absent when the turn
       * runs without a budget (the deterministic no-model path).
       */
      iteration?: number;
      /**
       * The turn's whole iteration budget, so a consumer can show
       * `iteration N/M` instead of a bare count (#574). Carried with the
       * iteration rather than assumed, because the budget is per-turn state.
       */
      iterationLimit?: number;
    }
  /**
   * Tool-invocation lifecycle end. `summary` is a short human-readable
   * outcome ("3 concepts found"); `ok: false` marks a tool error the model
   * was told about (the turn itself continues).
   */
  | {
      type: "tool-end";
      callId: string;
      tool: string;
      ok: boolean;
      summary?: string;
      /**
       * Structured outcome for tools whose result reads as labelled rows rather
       * than a one-line summary (an API call's endpoint/method/status/response).
       * Must already be safe to show — the runtime caps and redacts it on write.
       */
      result?: Record<string, unknown>;
      durationMs: number;
    }
  /**
   * A live slice of the reasoning the model is writing right now (#584). The
   * fold accumulates deltas into a `running` thought step so the Thinking
   * panel streams the reasoning as it is generated, the way the answer text
   * streams — the terminal `thought` event then finalizes that step.
   */
  | { type: "thought-delta"; delta: string }
  /**
   * Model reasoning that preceded a tool call, whole and authoritative. It
   * finalizes the running thought step its deltas built (or appends one when
   * none streamed — stored traces and older streams carry only this event) —
   * this is what turns "text… then a search" into a visible thought.
   */
  | { type: "thought"; text: string }
  | { type: "part"; part: ChatReplyPart }
  | { type: "text-start"; action: string }
  | { type: "text-delta"; delta: string }
  | { type: "text-end" }
  | { type: "done"; conversationId: string; messageId: string | null }
  | { type: "error"; message: string };

/**
 * Who a turn verifiably speaks for (#667/#668/#669, ADR-0020): resolved
 * server-side from the session or the sealed SSO gate cookie — never from
 * request bodies or model output. The tool-registration policy reads it to
 * decide which Entity/custom-tool variants exist in the turn.
 */
export interface ToolSubject {
  type: ConversationSubject;
  /** The verified OIDC subject when type === "sso"; never client-supplied. */
  subjectId: string | null;
  /** The verified identity-claim value, when the SSO connection opted in. */
  claimValue: string | null;
}

/** Mid-conversation long-term memory recall (#664), pre-scoped to the turn's subject. */
export type MemorySearcher = (query: string) => Promise<Array<{ text: string }>>;

/** Live Entity-Record read for the auto-generated Entity tools (#665). */
export type EntityRecordsFetcher = (
  entityId: string,
  query: EntityRecordQuery
) => Promise<EntityRecord[]>;

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  /**
   * Set when this turn put a question to the Visitor but its text cannot show
   * it — a clarification is persisted as a `clarify` part with no text part, so
   * it flattens to "". Read by the courtesy detector, which must not treat the
   * Visitor's `ok` answer as small talk (#566). The model prompts ignore it.
   */
  askedQuestion?: boolean;
}

/**
 * A side effect a Flow Action *requests*, applied by the caller AFTER the
 * assistant turn is persisted — so it can link to the saved message id and
 * only fire on a committed turn. Handlers stay pure: they describe the effect,
 * they never perform it. See docs/ARCHITECTURE.md §5.1.
 */
export type ActionEffect =
  | { kind: "create_improvement"; title: string }
  | {
      kind: "send_email";
      to: string;
      subject: string;
      body: string;
      replyTo?: string;
    };

/** Everything a Flow Action handler needs; the engine builds one per turn. */
export interface ActionContext {
  assistant: Assistant;
  /**
   * The immutable platform (Ciele) system-prompt layer — always composed
   * ABOVE the assistant's own answeringStyle (see lib/platform.ts).
   */
  platformPrompt: string;
  flow: Flow;
  message: string;
  history: HistoryMessage[];
  /**
   * Active Knowledge Collection anchor for this conversation, or null when the
   * turn is assistant-wide. A live retrieval signal (see the #53 audit): it
   * both scopes `searchKnowledge` upstream and seeds the Agentic Search context
   * frame (query-understanding.ts). Undefined in contexts that don't set it.
   */
  collectionId?: string | null;
  /**
   * Resolved template-variable catalog for this turn (see template.ts), shared
   * by every action that interpolates `{{…}}` tokens (Button text today).
   */
  templateContext?: TemplateContext;
  /** Null in the deterministic fallback; generative handlers require a model. */
  chatModel: LanguageModel | null;
  /**
   * The cheap/fast classifier-tier model (see CLASSIFIER_MODEL in models.ts),
   * for light generation where latency dominates quality — follow-up chips
   * render after the answer is already on screen, so every millisecond here is
   * pure perceived lag. Null or absent falls back to `chatModel`.
   */
  fastModel?: LanguageModel | null;
  searchKnowledge?: KnowledgeSearcher;
  /**
   * Reads one knowledge document whole, for the windowed `readKnowledgeSource`
   * tool. Absent leaves that tool unregistered (spec #559).
   */
  readKnowledgeDocument?: (id: string) => Promise<KnowledgeDocument | null>;
  /**
   * The Assistant's API catalogue integration, credential still sealed. Absent
   * or empty leaves the three catalogue tools unregistered (spec #559).
   */
  apiIntegration?: ApiIntegration | null;
  /** Persistent cross-turn session state (see session.ts). */
  session: TurnSession;
  /**
   * Whether an earlier turn in THIS conversation already asked the Visitor to
   * clarify. The anti-loop guarantee (#558): the terminal tool coerces a second
   * clarification request into a best-effort answer, because asking twice is a
   * loop and reads as refusing to try.
   */
  alreadyClarified?: boolean;
  /** Skills attached to the assistant, layered into the system prompt. */
  skills: SkillSnapshot[];
  /**
   * Long-term memories recalled for the turn's SSO subject (#664), layered
   * into the system prompt as the "Long-term memory" block. Absent when the
   * org toggle is off, the subject is anonymous, or nothing was relevant.
   */
  longTermMemory?: string[];
  /**
   * Mid-conversation long-term memory recall for the `searchMemories` tool
   * (#664). Present only under the same gate as `longTermMemory` — its
   * presence is what registers the tool.
   */
  searchMemories?: MemorySearcher;
  /**
   * Selected shared Entities (#665): the Publication snapshot on the widget,
   * live rows in Preview. With `queryEntityRecords`, each yields the
   * auto-generated retrieval tools.
   */
  entities?: EntitySnapshot[];
  /** Live Record read for the Entity tools, bound over the turn's Db. */
  queryEntityRecords?: EntityRecordsFetcher;
  /**
   * Who the turn verifiably speaks for (#667/#668): the registration
   * policy — not the model — reads this to decide which tool variants
   * exist in the turn (ADR-0020).
   */
  toolSubject?: ToolSubject;
  /**
   * Reply parts already produced earlier in this same turn — the same array
   * the engine accumulates into, so a later action can ground itself in what
   * an earlier one produced (e.g. follow_up_questions reading the answer
   * search_knowledge just gave).
   */
  priorParts: ChatReplyPart[];
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  /**
   * Reports one model call's token totals for the AI usage ledger. Pre-bound
   * by the engine with the turn's resolved provider/model and the `generate`
   * stage — handlers only pass numbers. Optional so pure handlers and tests
   * that never touch the model don't need it.
   */
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  /**
   * Like `recordUsage`, but pre-bound with the classifier-tier provider/model
   * identity, so a handler that ran on `fastModel` meters the model that
   * actually answered. Present exactly when `fastModel` is.
   */
  recordFastUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
  }) => void;
  /**
   * True on the admin Preview surface, where provider internals (raw finish
   * reasons, error details) may be shown as diagnostics. Widget visitors
   * never see them.
   */
  previewSurface?: boolean;
  /**
   * Lazily recommends the best-matching help desk id for escalation chips
   * ("AI recommended help desk", see help-desk-recommend.ts). Cached per
   * turn; null (or absent) renders the generic desk menu.
   */
  recommendHelpDesk?: () => Promise<string | null>;
}

/**
 * What a handler returns: reply parts (already streamed via `emit`, returned
 * so the engine can persist them), deferred effects, and whether to halt the
 * remaining actions in the flow (e.g. handover).
 */
export interface ActionResult {
  parts: ChatReplyPart[];
  effects?: ActionEffect[];
  halt?: boolean;
  /** Handover target Assistant id — the turn continues there (one hop). */
  handoverTo?: string;
  /**
   * Template variables this action contributes to the turn's context for
   * *later* actions to interpolate (e.g. api_request JSON-path extractions,
   * `{{variableName}}`). The engine merges these into `templateContext` after
   * the action runs; extracted keys take precedence over the built-in catalog.
   */
  templatePatch?: Record<string, string>;
}

/** The Flow Action handler interface — one Adapter per action (see actions.ts). */
export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

/**
 * One metered model call: stage + the provider/model that actually ran (post
 * cross-provider fallback) + token totals. Collected per turn by the engine
 * and persisted post-commit by the Conversation Turn (AI usage ledger).
 */
export interface UsageEvent {
  stage: AiUsageStage;
  provider: Provider;
  modelId: string;
  /** Which credential answered (platform-funded vs BYOK etc.). */
  credentialKind: AiCredentialKind;
  inputTokens: number;
  outputTokens: number;
}

export interface RunResult {
  parts: ChatReplyPart[];
  effects: ActionEffect[];
  flowId: string | null;
  flowName: string;
  /** Model-call usage collected this turn, in call order. */
  usage: UsageEvent[];
  /**
   * Set when a handover action ran with a target: the Conversation Turn
   * continues this same message inside the target Assistant's Publication
   * (one hop only — the continuation's own handovers are ignored).
   */
  handoverTo?: string | null;
}
