/**
 * Guardrails: per-Assistant checks an organization puts around every Visitor
 * turn. Four read the Visitor's message before any Flow routes it, and one
 * rewrites the answer while it streams:
 *
 * - `input_length_limit`: the message is longer than a character or token cap.
 * - `moderation`: a moderation model flags the message.
 * - `regexp_guardrail`: the message matches a regular expression.
 * - `restrict_to_topic`: the message's main topic is none of the listed ones.
 * - `sensitive_content_stream`: text the model writes between a start and a
 *   stop marker never reaches the Visitor; one safe message stands in for it.
 *
 * This module is the vocabulary and every rule that needs no I/O: the shapes,
 * their validation, the two deterministic input checks, and the marker
 * suppressor, which is a state machine precisely so the streamed text and the
 * persisted text are the same function of the model's output. The two
 * model-backed checks run in `@agent-hub/agent`.
 */

/**
 * In run order: the Guardrails page groups by type in this order and saves the
 * list the same way, so the two exact checks, which cost nothing, run before
 * the two that call a model.
 */
export const GUARDRAIL_TYPES = [
  "input_length_limit",
  "regexp_guardrail",
  "moderation",
  "restrict_to_topic",
  "sensitive_content_stream",
] as const;
export type GuardrailType = (typeof GUARDRAIL_TYPES)[number];

/** At most this many guardrails per Assistant. */
export const GUARDRAIL_CAP = 20;
/** At most this many topics in one `restrict_to_topic` guardrail. */
export const GUARDRAIL_TOPIC_CAP = 20;
/** Pattern length cap: a tenant regex runs on every Visitor message. */
export const GUARDRAIL_PATTERN_MAX = 500;
/**
 * A tenant regex never sees more than this many characters of a message. The
 * cap bounds the cost of a pathological pattern; a JS regex has no timeout.
 */
export const GUARDRAIL_REGEX_INPUT_MAX = 10_000;

/**
 * `text-moderation-latest` is not offered: OpenAI's current moderation guide
 * lists only the omni model, which is also the one that is free.
 */
export const MODERATION_MODELS = ["omni-moderation-latest"] as const;
export type ModerationModel = (typeof MODERATION_MODELS)[number];

/** OpenAI's moderation categories (omni). Empty selection = any flag blocks. */
export const MODERATION_CATEGORIES = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
] as const;

interface GuardrailCommon {
  id: string;
  /** The admin's own label, shown in the list and on the Inbox flow marker. */
  name: string;
  enabled: boolean;
  /**
   * What the Visitor reads instead: the reply to a blocked message, or, for
   * `sensitive_content_stream`, the text that replaces a suppressed span.
   */
  message: string;
}

/**
 * What a model-backed check does when it cannot answer (no credential, an
 * outage, a timeout). `allow` keeps the Assistant up; `block` keeps the
 * guarantee. Deterministic checks never fail, so they have no such setting.
 */
export type GuardrailFailureMode = "allow" | "block";

/**
 * What an input check does when it fires. `block` answers with the message and
 * ends the turn; `log` only records the hit, so an admin can watch a new check
 * against real traffic before it turns anyone away.
 */
export type GuardrailAction = "block" | "log";

export type AssistantGuardrail =
  | (GuardrailCommon & {
      type: "input_length_limit";
      action: GuardrailAction;
      unit: "characters" | "tokens";
      max: number;
    })
  | (GuardrailCommon & {
      type: "moderation";
      action: GuardrailAction;
      provider: "openai";
      model: ModerationModel;
      /** Categories that block. Empty: any flagged category blocks. */
      categories: string[];
      onError: GuardrailFailureMode;
    })
  | (GuardrailCommon & {
      type: "regexp_guardrail";
      action: GuardrailAction;
      pattern: string;
      caseInsensitive: boolean;
    })
  | (GuardrailCommon & {
      type: "restrict_to_topic";
      action: GuardrailAction;
      topics: string[];
      onError: GuardrailFailureMode;
    })
  | (GuardrailCommon & {
      type: "sensitive_content_stream";
      startMarker: string;
      stopMarker: string;
    });

export type InputGuardrail = Exclude<AssistantGuardrail, { type: "sensitive_content_stream" }>;
export type StreamGuardrail = Extract<AssistantGuardrail, { type: "sensitive_content_stream" }>;

export const GUARDRAIL_LABELS: Record<GuardrailType, { title: string; summary: string }> = {
  input_length_limit: {
    title: "Input length limit",
    summary: "Blocks a message longer than a character or token limit.",
  },
  moderation: {
    title: "Moderation",
    summary: "Sends the message to a moderation model and blocks what it flags.",
  },
  regexp_guardrail: {
    title: "Regular expression",
    summary: "Blocks a message that matches a regular expression.",
  },
  restrict_to_topic: {
    title: "Restrict to topic",
    summary: "Blocks a message whose main topic is not in your list.",
  },
  sensitive_content_stream: {
    title: "Sensitive content in stream",
    summary: "Hides answer text between a start and a stop marker while it streams.",
  },
};

/** A new guardrail of `type`, ready to edit. */
export function defaultGuardrail(type: GuardrailType, id: string): AssistantGuardrail {
  const common = { id, name: GUARDRAIL_LABELS[type].title, enabled: true };
  switch (type) {
    case "input_length_limit":
      return {
        ...common,
        type,
        action: "block",
        unit: "characters",
        max: 2000,
        message: "Your message is too long. Please shorten it and try again.",
      };
    case "moderation":
      return {
        ...common,
        type,
        action: "block",
        provider: "openai",
        model: "omni-moderation-latest",
        categories: [],
        onError: "allow",
        message: "I can't help with that message.",
      };
    case "regexp_guardrail":
      return {
        ...common,
        type,
        action: "block",
        pattern: "",
        caseInsensitive: true,
        message: "I can't help with that message.",
      };
    case "restrict_to_topic":
      return {
        ...common,
        type,
        action: "block",
        topics: [],
        onError: "allow",
        message: "I can only help with the topics this assistant covers.",
      };
    case "sensitive_content_stream":
      return {
        ...common,
        type,
        startMarker: "",
        stopMarker: "",
        message: "[content removed]",
      };
  }
}

/** Why a guardrail cannot be saved, or null. One reason, the first found. */
export function guardrailProblem(guardrail: AssistantGuardrail): string | null {
  if (!guardrail.name.trim()) return "Give the guardrail a name.";
  if (guardrail.name.length > 100) return "Use a name of 100 characters or fewer.";
  if (guardrail.message.length > 1000) return "Use a message of 1000 characters or fewer.";
  if (guardrail.type !== "sensitive_content_stream") {
    if (guardrail.action !== "block" && guardrail.action !== "log") return "Choose block or log only.";
    if (!guardrail.message.trim()) return "Write the message the visitor sees when the guardrail blocks.";
  }
  switch (guardrail.type) {
    case "input_length_limit":
      return Number.isInteger(guardrail.max) && guardrail.max >= 1 && guardrail.max <= 1_000_000
        ? null
        : "Set a limit between 1 and 1,000,000.";
    case "moderation":
      if (!(MODERATION_MODELS as readonly string[]).includes(guardrail.model)) return "Choose a moderation model.";
      return guardrail.categories.every((c) => (MODERATION_CATEGORIES as readonly string[]).includes(c))
        ? null
        : "Pick categories from the list.";
    case "regexp_guardrail":
      if (!guardrail.pattern) return "Write a pattern.";
      if (guardrail.pattern.length > GUARDRAIL_PATTERN_MAX) {
        return `Use a pattern of ${GUARDRAIL_PATTERN_MAX} characters or fewer.`;
      }
      return compilePattern(guardrail) ? null : "The pattern is not a valid regular expression.";
    case "restrict_to_topic": {
      const topics = guardrail.topics.map((t) => t.trim()).filter(Boolean);
      if (topics.length === 0) return "Add at least one topic.";
      if (topics.length > GUARDRAIL_TOPIC_CAP) return `Use ${GUARDRAIL_TOPIC_CAP} topics or fewer.`;
      return topics.every((t) => t.length <= 200) ? null : "Keep each topic to 200 characters.";
    }
    case "sensitive_content_stream":
      if (!guardrail.startMarker || !guardrail.stopMarker) return "Set both markers.";
      if (guardrail.startMarker.length > 100 || guardrail.stopMarker.length > 100) {
        return "Keep each marker to 100 characters.";
      }
      return null;
  }
}

/**
 * The list in run order: grouped by type in {@link GUARDRAIL_TYPES} order, the
 * admin's order kept within each type.
 */
export function orderGuardrails(guardrails: readonly AssistantGuardrail[]): AssistantGuardrail[] {
  const rank = (g: AssistantGuardrail) => GUARDRAIL_TYPES.indexOf(g.type);
  return [...guardrails].sort((a, b) => rank(a) - rank(b));
}

/** The problem with a whole list, or null: each guardrail, then the cap. */
export function guardrailListProblem(guardrails: readonly AssistantGuardrail[]): string | null {
  if (guardrails.length > GUARDRAIL_CAP) return `Use ${GUARDRAIL_CAP} guardrails or fewer.`;
  if (new Set(guardrails.map((g) => g.id)).size !== guardrails.length) return "Guardrail ids must be unique.";
  for (const guardrail of guardrails) {
    const problem = guardrailProblem(guardrail);
    if (problem) return `${guardrail.name || GUARDRAIL_LABELS[guardrail.type].title}: ${problem}`;
  }
  return null;
}

/** The enabled input checks, in run order (see {@link orderGuardrails}). */
export function inputGuardrails(guardrails: readonly AssistantGuardrail[] | undefined): InputGuardrail[] {
  return orderGuardrails(guardrails ?? []).filter(
    (g): g is InputGuardrail => g.enabled && g.type !== "sensitive_content_stream"
  );
}

/** The enabled stream rules, in the admin's order. */
export function streamGuardrails(guardrails: readonly AssistantGuardrail[] | undefined): StreamGuardrail[] {
  return (guardrails ?? []).filter(
    (g): g is StreamGuardrail => g.enabled && g.type === "sensitive_content_stream"
  );
}

/**
 * A token count without a tokenizer: four characters a token, rounded up.
 * Tokenizers differ by model and the limit is a policy, not a context-window
 * guard, so one stated approximation beats a per-provider count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compilePattern(guardrail: { pattern: string; caseInsensitive: boolean }): RegExp | null {
  try {
    return new RegExp(guardrail.pattern, guardrail.caseInsensitive ? "iu" : "u");
  } catch {
    return null;
  }
}

/**
 * Whether a deterministic check blocks `message`. Null for a model-backed
 * type, which this module cannot answer. An invalid stored pattern blocks:
 * saving refuses one, so only a hand-edited row holds it, and a check that
 * cannot run must not read as a check that passed.
 */
export function deterministicViolation(guardrail: InputGuardrail, message: string): boolean | null {
  switch (guardrail.type) {
    case "input_length_limit": {
      const size = guardrail.unit === "tokens" ? estimateTokens(message) : [...message].length;
      return size > guardrail.max;
    }
    case "regexp_guardrail": {
      const pattern = compilePattern(guardrail);
      return pattern ? pattern.test(message.slice(0, GUARDRAIL_REGEX_INPUT_MAX)) : true;
    }
    default:
      return null;
  }
}

/**
 * One input check's result, as the stored turn trace keeps it. `logged`: the
 * check fired on a `log` guardrail and the turn went on. `unavailable`: a
 * model-backed check could not answer and its `onError` is `allow`.
 */
export interface GuardrailTraceEntry {
  id: string;
  type: InputGuardrail["type"];
  name: string;
  outcome: "pass" | "blocked" | "logged" | "unavailable";
  /** Why it blocked or could not run. Never shown to a Visitor. */
  detail?: string;
}

export interface MarkerSuppressor {
  /** Feed the next delta; returns what may be shown now. */
  push(delta: string): string;
  /** The stream ended; returns what was held back. */
  end(): string;
}

/**
 * The `sensitive_content_stream` state machine. Outside a span, text passes
 * through except a tail that could still turn into a start marker; inside,
 * text is dropped until the stop marker, and the rule's message is shown once
 * where the span began. A span the model never closes stays hidden, because a
 * missing stop marker is not permission.
 */
export function createMarkerSuppressor(rules: readonly StreamGuardrail[]): MarkerSuppressor {
  let pending = "";
  let inside: StreamGuardrail | null = null;

  const drain = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (inside) {
        const stopAt = pending.indexOf(inside.stopMarker);
        if (stopAt === -1) {
          // Keep only what could be the start of the stop marker.
          pending = final ? "" : pending.slice(Math.max(0, pending.length - (inside.stopMarker.length - 1)));
          return out;
        }
        pending = pending.slice(stopAt + inside.stopMarker.length);
        inside = null;
        continue;
      }
      let first: { at: number; rule: StreamGuardrail } | null = null;
      for (const rule of rules) {
        const at = pending.indexOf(rule.startMarker);
        if (at !== -1 && (!first || at < first.at)) first = { at, rule };
      }
      if (first) {
        out += pending.slice(0, first.at) + first.rule.message;
        pending = pending.slice(first.at + first.rule.startMarker.length);
        inside = first.rule;
        continue;
      }
      if (final) {
        out += pending;
        pending = "";
        return out;
      }
      const hold = heldTail(pending, rules);
      out += pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      return out;
    }
  };

  return {
    push(delta) {
      if (rules.length === 0) return delta;
      pending += delta;
      return drain(false);
    },
    end() {
      if (rules.length === 0) return "";
      return drain(true);
    },
  };
}

/** Length of the longest tail of `text` that some start marker begins with. */
function heldTail(text: string, rules: readonly StreamGuardrail[]): number {
  let hold = 0;
  for (const rule of rules) {
    const marker = rule.startMarker;
    for (let n = Math.min(marker.length - 1, text.length); n > hold; n--) {
      if (marker.startsWith(text.slice(text.length - n))) {
        hold = n;
        break;
      }
    }
  }
  return hold;
}

/** The whole-text form of the suppressor, for what is persisted. */
export function suppressMarkedContent(text: string, rules: readonly StreamGuardrail[]): string {
  if (rules.length === 0) return text;
  const suppressor = createMarkerSuppressor(rules);
  return suppressor.push(text) + suppressor.end();
}
