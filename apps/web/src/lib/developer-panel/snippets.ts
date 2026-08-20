import type { Role } from "@agent-hub/core";
import { CAPABILITY_GUARDS } from "@/lib/rbac";
import type {
  PanelCapability,
  PanelDomain,
  PanelOperation,
  SnippetTab,
} from "./types";

/**
 * The Developer Panel's snippet builder (#754): the one new seam this feature
 * adds. Pure (no React, no registry, no network), so the decisions that matter
 * (which id lands where, what an uncovered operation shows, how a deep body
 * reads, whose origin a command reaches) are tested directly.
 *
 * Templates are hand-authored strings in the /api/v1 contract registry rather
 * than functions: a string is greppable by the fidelity tests, diffable in
 * review, and cannot smuggle logic into what is meant to be documentation.
 */

export interface SnippetContext {
  /** This deployment's own origin. A self-host must never copy the hosted one. */
  origin: string;
  /** Ids the current page registered, keyed by the vocabulary below. */
  variables: Record<string, string>;
}

export interface RenderedSnippet {
  /** The code to show, or null when this surface does not cover the operation. */
  code: string | null;
  /** What to say instead of a code block when `code` is null. */
  unavailable: string | null;
  /** Labels the block; there is no highlighter in this workspace. */
  language: string;
}

const IRREGULAR: Record<string, string> = {
  entities: "entity",
  memories: "memory",
};

/** "help-desks" → "helpDesk", "api-keys" → "apiKey", "entities" → "entity". */
function singularCamel(segment: string): string {
  const singular =
    IRREGULAR[segment] ??
    (segment.endsWith("ies")
      ? `${segment.slice(0, -3)}y`
      : segment.endsWith("s")
        ? segment.slice(0, -1)
        : segment);
  const [head, ...rest] = singular.split("-");
  return [head, ...rest.map((part) => part[0].toUpperCase() + part.slice(1))].join("");
}

/**
 * The placeholder vocabulary, derived from the path rather than declared.
 *
 * `{id}` means whichever resource owns it: the same token is the Assistant in
 * `/assistants/{id}/flows` and the Flow in `/flows/{id}`, so it is renamed
 * after the preceding segment. A parameter that already carries its own name
 * (`{channelId}`, `{userId}`) keeps it.
 */
export function pathVariableName(path: string, param: string): string {
  if (param !== "id") return param;
  const segments = path.split("/").filter(Boolean);
  const index = segments.indexOf("{id}");
  const owner = index > 0 ? segments[index - 1] : null;
  return owner ? `${singularCamel(owner)}Id` : "id";
}

/** Fill `{name}` placeholders; an unsupplied one survives as itself. */
export function substituteTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match
  );
}

/** The request path with each parameter resolved through the vocabulary. */
function resolvePath(path: string, variables: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_match, param: string) => {
    const name = pathVariableName(path, param);
    return Object.prototype.hasOwnProperty.call(variables, name)
      ? variables[name]
      : `{${name}}`;
  });
}

function buildCurl(op: PanelOperation, ctx: SnippetContext): string {
  const lines = [`curl ${ctx.origin}/api/v1${resolvePath(op.path, ctx.variables)}`];
  if (op.method !== "get") lines.push(`--request ${op.method.toUpperCase()}`);
  lines.push('--header "Authorization: Bearer $CIELE_API_KEY"');
  if (op.multipart) {
    // A file upload, so no JSON content type and no body template. The field
    // names are the contract, the file is the caller's.
    for (const field of op.multipart) lines.push(`--form ${field}=@./your-file`);
  } else if (op.body) {
    lines.push('--header "Content-Type: application/json"');
    const indented = op.body
      .split("\n")
      .map((line, index) => (index === 0 ? line : `  ${line}`))
      .join("\n");
    lines.push(`--data '${indented}'`);
  }
  const [first, ...rest] = lines;
  return [first, ...rest.map((line) => `  ${line}`)].join(" \\\n");
}

function buildMcp(
  op: PanelOperation,
  domain: PanelDomain,
  ctx: SnippetContext
): string {
  const args = substituteTemplate(op.mcp ?? "{}", ctx.variables);
  try {
    return `${domain.mcpTool} ${JSON.stringify(JSON.parse(args), null, 2)}`;
  } catch {
    // The template is hand-authored prose until the fidelity test runs; show
    // it raw rather than throwing in a reader's face.
    return `${domain.mcpTool} ${args}`;
  }
}

const UNAVAILABLE: Record<SnippetTab, string> = {
  cli: "No CLI command covers this operation yet. Use the cURL or MCP tab.",
  curl: "This operation has no HTTP endpoint.",
  mcp: "No MCP tool covers this operation. Use the CLI or cURL tab.",
};

const LANGUAGE: Record<SnippetTab, string> = {
  cli: "bash",
  curl: "bash",
  mcp: "json",
};

/** One operation, rendered for one tab. */
export function buildSnippet(
  tab: SnippetTab,
  op: PanelOperation,
  domain: PanelDomain,
  ctx: SnippetContext
): RenderedSnippet {
  const language = LANGUAGE[tab];
  if (tab === "cli") {
    return op.cli
      ? { code: substituteTemplate(op.cli, ctx.variables), unavailable: null, language }
      : { code: null, unavailable: UNAVAILABLE.cli, language };
  }
  if (tab === "mcp") {
    return op.mcp
      ? { code: buildMcp(op, domain, ctx), unavailable: null, language }
      : { code: null, unavailable: UNAVAILABLE.mcp, language };
  }
  return { code: buildCurl(op, ctx), unavailable: null, language };
}

/* -------------------------------------------------------------------------- */
/* Request-body shapes                                                        */
/* -------------------------------------------------------------------------- */

/** The subset of JSON Schema the registry's zod bodies render into. */
interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  enum?: unknown[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
}

/** How many levels of object nesting a body prints before it is elided. */
const MAX_BODY_DEPTH = 2;

function scalar(node: JsonSchemaNode): string {
  if (node.enum) {
    return `<${node.enum.map((value) => JSON.stringify(value)).join(" | ")}>`;
  }
  const variants = node.anyOf ?? node.oneOf;
  if (variants) return `<${variants.map(scalar).map((s) => s.slice(1, -1)).join(" | ")}>`;
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  return `<${type ?? "any"}>`;
}

function renderNode(node: JsonSchemaNode, depth: number, indent: string): string {
  if (node.type === "array") {
    const items = node.items ?? {};
    return items.properties && depth < MAX_BODY_DEPTH
      ? `[${renderNode(items, depth + 1, indent)}]`
      : `[${items.properties ? "{ … }" : scalar(items)}]`;
  }
  if (!node.properties) return scalar(node);
  if (depth >= MAX_BODY_DEPTH) return "{ … }";
  const inner = indent + "  ";
  const rows = Object.entries(node.properties).map(
    ([key, child]) => `${inner}${JSON.stringify(key)}: ${renderNode(child, depth + 1, inner)}`
  );
  return `{\n${rows.join(",\n")}\n${indent}}`;
}

/**
 * A request body as its *shape*: typed placeholders, not invented values, so
 * nobody pastes plausible-looking fiction into a real Organization. Anything
 * past two levels is elided with a `{ … }`; the machine-readable contract at
 * `/api/v1/openapi.json` is the full story, and the panel links to it.
 */
export function renderBodyShape(schema: unknown): string | null {
  const node = schema as JsonSchemaNode | null;
  if (!node || typeof node !== "object") return null;
  if (!node.properties || Object.keys(node.properties).length === 0) {
    // A union body (the "text or url source" shape) still has variants worth
    // showing; a bare object has nothing.
    const variants = node.anyOf ?? node.oneOf;
    if (!variants?.length) return null;
    return renderNode(variants[0], 0, "");
  }
  return renderNode(node, 0, "");
}

/* -------------------------------------------------------------------------- */
/* Role badges                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The lowest Role an API key can carry and still be allowed the operation.
 *
 * **Derived from the guards themselves**, not from a table of role names: this
 * used to mirror the rank ladder as a switch, and nothing tied the two, so
 * raising a threshold in `lib/rbac.ts` would have made the badge lie in silence.
 *
 * This is about the **key**, never the person reading the panel. An Owner can
 * mint a Viewer key, and that key deletes nothing; greying an operation out
 * against the viewer's own Role would assert something different and wrong.
 */
const ROLE_LADDER: Role[] = ["viewer", "editor", "admin", "owner"];

export function capabilityRole(capability: PanelCapability): Role | null {
  // "member" means any valid key. A badge saying so on every read is noise.
  if (capability === "member") return null;
  return ROLE_LADDER.find((role) => CAPABILITY_GUARDS[capability](role)) ?? null;
}
