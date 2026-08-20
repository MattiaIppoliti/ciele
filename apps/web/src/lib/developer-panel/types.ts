import type { ApiV1Domain } from "@/lib/api-v1/meta";

/**
 * The Developer Panel's wire types (#754).
 *
 * The panel is a client component and the /api/v1 contract registry is a server
 * module that imports `@ciele/ops`, so the catalogue crosses that boundary as
 * plain JSON, built server-side by `catalogue.ts` and fetched on demand by the
 * panel. Nothing in this file may import the registry, the ops layer or the Db:
 * it is the shape both sides agree on, and it ships in the client bundle.
 */

/**
 * The capability ladder, mirrored for the client. `catalogue.ts` asserts at
 * compile time that this stays identical to the ops layer's own union, so the
 * mirror cannot drift without a typecheck failure.
 */
export type PanelCapability =
  | "member"
  | "edit"
  | "publish"
  | "manageMembers"
  | "manageApiKeys"
  | "changeRoles";

export type PanelMethod = "get" | "post" | "put" | "patch" | "delete";

export interface PanelOperation {
  /** Stable key, and what the drift tests report on: "patch /flows/{id}". */
  id: string;
  method: PanelMethod;
  /** OpenAPI-style path relative to /api/v1, e.g. "/flows/{id}". */
  path: string;
  summary: string;
  /** The Role the API key must carry, never the viewing Member's Role. */
  capability: PanelCapability;
  /** Honors the Idempotency-Key header. */
  idempotent: boolean;
  /**
   * `ciele …` template, or null when no CLI verb covers this operation. Null is
   * rendered as a sentence, never as an empty code block.
   */
  cli: string | null;
  /** MCP tool arguments as a JSON template, or null when no tool covers it. */
  mcp: string | null;
  /** Request-body shape, already truncated for reading; null when there is none. */
  body: string | null;
  /** Multipart field names, for endpoints that take a file instead of JSON. */
  multipart: string[] | null;
}

export interface PanelDomain {
  /** One of the deployment's advertised /api/v1 domains. */
  domain: ApiV1Domain;
  /** What the top-bar button and the panel heading say: "Flows API". */
  title: string;
  /** The coarse MCP tool that covers this domain, e.g. "manage_flows". */
  mcpTool: string;
  /** Hand-written prompt to paste into an agent: how MCP is actually used. */
  mcpPrompt: string;
  /** Per-tab documentation page, as a path under the docs origin. */
  docs: { cli: string; curl: string; mcp: string };
  operations: PanelOperation[];
}

/**
 * What the Authentication block needs. The key itself can never appear here:
 * keys are stored as hashes, so `hasKeys` is the most the server can say.
 */
export interface PanelAuth {
  /** This deployment's own origin: a self-host must not copy the hosted one. */
  origin: string;
  /**
   * Whether the Organization has at least one key, or null when the viewer is
   * not allowed to know, which is also how the panel knows to say who can mint
   * one. Claiming "no keys yet" to someone who simply cannot see them would be a
   * guess dressed as a fact.
   */
  hasKeys: boolean | null;
  /** Mock-Db demo build: the panel is present, but no API key can exist. */
  demo: boolean;
}

export interface DeveloperPanelData {
  domains: PanelDomain[];
  auth: PanelAuth;
  /** Where the documentation site lives for this deployment. */
  docsOrigin: string;
}

export const SNIPPET_TABS = ["cli", "curl", "mcp"] as const;
export type SnippetTab = (typeof SNIPPET_TABS)[number];

export const SNIPPET_TAB_LABELS: Record<SnippetTab, string> = {
  cli: "CLI",
  curl: "cURL",
  mcp: "MCP",
};
