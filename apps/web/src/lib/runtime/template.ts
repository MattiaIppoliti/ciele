import type { ConversationMetadata } from "@agent-hub/db";
import type { HistoryMessage } from "./types";

/**
 * Shared template-variable engine for the chat runtime. One catalog, one
 * resolver: the runtime (Button text today, the API request action next)
 * consumes TEMPLATE_VARIABLES and resolveTemplate. The Flow Builder's variable
 * picker/docs modal consumes the same catalog once it's surfaced through a
 * barrel (#185) — keeping every surface derived from this single source.
 * Internal to the runtime deep module until then.
 *
 * Catalog scope (locked on wayfinder map #170): `conversation.summary` is
 * deferred (needs an LLM call); `course.*` and `session.id` are out of scope.
 * An unresolved catalog variable renders as an empty string; a token that isn't
 * in the catalog is left untouched.
 */

/** One entry the picker/docs UI renders and the resolver can fill. */
export interface TemplateVariable {
  token: string;
  description: string;
}

/** The authoritative catalog. Descriptions are industry-neutral by policy. */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { token: "{{user.name}}", description: "User full name" },
  { token: "{{user.email}}", description: "User email address" },
  { token: "{{user.id}}", description: "User unique identifier" },
  { token: "{{workflow.name}}", description: "The name of the current workflow" },
  {
    token: "{{workflow.message}}",
    description: "The message that triggered this workflow",
  },
  {
    token: "{{conversation.link}}",
    description: "Link to the current conversation in the inbox",
  },
  {
    token: "{{conversation.history}}",
    description: "The entire conversation history",
  },
  {
    token: "{{conversation.metadata.launch_url}}",
    description: "URL where the conversation was started",
  },
  {
    token: "{{conversation.metadata.ip_address}}",
    description: "User's IP address",
  },
  { token: "{{conversation.metadata.browser}}", description: "User's browser" },
  {
    token: "{{conversation.metadata.os}}",
    description: "User's operating system",
  },
  {
    token: "{{conversation.metadata.resolution}}",
    description: "User's screen resolution",
  },
  {
    token: "{{conversation.metadata.language}}",
    description: "User's language",
  },
  {
    token: "{{conversation.metadata.country}}",
    description: "User's country code (ISO 3166-1 alpha-2)",
  },
  { token: "{{conversation.metadata.city}}", description: "User's city" },
] as const;

/** Bare `name` (no braces) → resolved value, for every catalog variable. */
export type TemplateContext = Record<string, string>;

/** Transcript longer than this is truncated, keeping the most recent turns. */
const HISTORY_CHAR_CAP = 4000;

function renderHistory(history: HistoryMessage[]): string {
  const lines = history.map(
    (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`
  );
  const transcript = lines.join("\n");
  if (transcript.length <= HISTORY_CHAR_CAP) return transcript;
  // Keep the tail — the most recent turns are the most relevant.
  return `…\n${transcript.slice(transcript.length - HISTORY_CHAR_CAP)}`;
}

export interface TemplateContextInput {
  user?: { name?: string; email?: string; id?: string };
  workflowName?: string;
  message?: string;
  history?: HistoryMessage[];
  metadata?: ConversationMetadata;
  conversationId: string;
  /** Admin console origin for conversation.link, e.g. https://platform.ciele.app. */
  appOrigin: string;
}

/**
 * Resolves the catalog once per turn into a flat token→value map. Missing
 * inputs simply don't populate their keys, so the resolver renders them empty.
 */
export function buildTemplateContext(
  input: TemplateContextInput
): TemplateContext {
  const meta = input.metadata ?? {};
  const entries: Record<string, string | undefined> = {
    "user.name": input.user?.name,
    "user.email": input.user?.email,
    "user.id": input.user?.id,
    "workflow.name": input.workflowName,
    "workflow.message": input.message,
    "conversation.link": `${input.appOrigin}/inbox/conversations/${input.conversationId}`,
    "conversation.history": input.history
      ? renderHistory(input.history)
      : undefined,
    "conversation.metadata.launch_url": meta.launchUrl,
    "conversation.metadata.ip_address": meta.ip,
    "conversation.metadata.browser": meta.browser,
    "conversation.metadata.os": meta.os,
    "conversation.metadata.resolution": meta.resolution,
    "conversation.metadata.language": meta.language,
    "conversation.metadata.country": meta.location,
    "conversation.metadata.city": meta.city,
  };
  const context: TemplateContext = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") context[key] = value;
  }
  return context;
}

/**
 * Returns a context with `workflow.name` set to the routed flow's name. The
 * base context is built before routing (turn.ts); the flow is only known once
 * the engine has classified intent, so it's grafted on here.
 */
export function withWorkflowName(
  context: TemplateContext | undefined,
  workflowName: string
): TemplateContext {
  return { ...(context ?? {}), "workflow.name": workflowName };
}

/** How a resolved value is escaped for the slot it lands in. */
export type EscapeMode = "plain" | "url-component" | "header" | "json-string";

function escapeValue(value: string, mode: EscapeMode): string {
  switch (mode) {
    case "url-component":
      return encodeURIComponent(value);
    case "header":
      // Header values are opaque bytes except line breaks (injection guard).
      return value.replace(/[\r\n\0]/g, "");
    case "json-string": {
      // JSON.stringify a string yields a quoted literal; drop the quotes so the
      // caller can splice it inside their own "…" without double-encoding.
      const json = JSON.stringify(value);
      return json.slice(1, json.length - 1);
    }
    case "plain":
      return value;
  }
}

const CATALOG_NAMES = new Set(
  TEMPLATE_VARIABLES.map((v) => v.token.slice(2, v.token.length - 2))
);

// `{{name}}`: catalog keys are lowercase-dotted; extracted variables (from
// api_request JSON paths) may be camelCase, so names allow mixed case. A token
// matching neither the catalog nor a context key is left verbatim downstream.
const TOKEN = /\{\{([A-Za-z0-9_.]+)\}\}/g;

/**
 * Replaces `{{name}}` tokens in `text` with their resolved values, escaped for
 * `mode`. A token resolves when its name is a catalog variable *or* a key the
 * context carries (e.g. an api_request JSON-path extraction); unresolved
 * catalog variables become empty strings. A token that is neither is left
 * verbatim — it isn't ours (`{{course.name}}`, `{{session.id}}`).
 */
export function resolveTemplate(
  text: string,
  context: TemplateContext,
  mode: EscapeMode = "plain"
): string {
  return text.replace(TOKEN, (whole, name: string) => {
    if (!CATALOG_NAMES.has(name) && !(name in context)) return whole;
    return escapeValue(context[name] ?? "", mode);
  });
}
