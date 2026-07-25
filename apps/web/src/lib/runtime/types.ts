import type { LanguageModel } from "ai";
import type {
  AiCredentialKind,
  AiUsageStage,
  Assistant,
  Flow,
  FlowAction,
  FlowButtonIcon,
  KnowledgeSearchResult,
  Provider,
  SkillSnapshot,
} from "@agent-hub/db";
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
  | {
      type: "button";
      action: "show_button";
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
 * Where a Thinking Step sits in the agent loop. The client folds stages into
 * the status phase the chat UIs display ("Deciding what to do…" /
 * "Looking into it…" / "Gathering info…" / "Cross-checking…").
 */
export type StepStage = "classify" | "generate" | "search" | "found";

/** Wire events streamed to the chat client (ndjson). */
export type RuntimeEvent =
  | { type: "turn"; conversationId: string }
  | { type: "flow"; flowId: string | null; flowName: string; isDefault: boolean }
  /** `detail` is an optional expandable annotation ("Model: gpt-4o-mini"). */
  | { type: "step"; label: string; stage?: StepStage; detail?: string }
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
      durationMs: number;
    }
  /**
   * Model reasoning that preceded a tool call. The client folds the text it
   * was streaming into the Thinking panel instead of the answer bubble —
   * this is what turns "text… then a search" into a visible thought.
   */
  | { type: "thought"; text: string }
  | { type: "part"; part: ChatReplyPart }
  | { type: "text-start"; action: string }
  | { type: "text-delta"; delta: string }
  | { type: "text-end" }
  | { type: "done"; conversationId: string; messageId: string | null }
  | { type: "error"; message: string };

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
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
  searchKnowledge?: KnowledgeSearcher;
  /** Persistent cross-turn session state (see session.ts). */
  session: TurnSession;
  /**
   * Whether an earlier turn in THIS conversation already emitted a clarify
   * part (derived from the persisted message history/parts upstream). The
   * Agentic Search anti-loop guardrail (#156): the runtime never re-clarifies a
   * message it already clarified — it gives a best-effort caveated answer
   * instead. Absent/false on a first-clarify or a fresh conversation.
   */
  alreadyClarified?: boolean;
  /** Skills attached to the assistant, layered into the system prompt. */
  skills: SkillSnapshot[];
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
