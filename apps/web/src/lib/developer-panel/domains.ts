import type { ApiV1Domain } from "@/lib/api-v1/meta";

/**
 * What the Developer Panel says *about* a domain (#754), as opposed to what the
 * /api/v1 contract registry says about its endpoints.
 *
 * This lives apart from `openapi.ts` on purpose: the OpenAPI document has no use
 * for a CLI tab's documentation link or an agent prompt, and `buildOpenApiDocument`
 * must not start carrying UI copy. Nothing here imports the registry, so the module
 * stays cheap and client-safe.
 *
 * **The MCP tool name belongs to the domain, not the endpoint.** The 14 MCP tools
 * are coarse and map onto the 18 domains many-to-one (one tool covers Skills,
 * Goals and Alerts; another covers Organization, Members and API Keys), so a
 * per-endpoint field would repeat a string with no added truth. The per-endpoint
 * half of an MCP call is its `action`, and that is a template in the registry.
 */

export interface DomainPresentation {
  /** The top-bar button label and the panel heading. */
  title: string;
  /** The coarse MCP tool that covers this domain. */
  mcpTool: string;
  /**
   * A prompt to paste into an agent. Written for a person who has the MCP server
   * connected and wants to see what asking for something looks like, so it names
   * an intent, not a tool call, and stays industry-agnostic.
   */
  mcpPrompt: string;
  /** Per-tab docs path; the origin comes from the deployment. */
  docs?: { cli?: string; curl?: string; mcp?: string };
}

const DEFAULT_DOCS = {
  cli: "/developers/cli",
  curl: "/developers/api",
  mcp: "/developers/mcp",
} as const;

export function domainDocs(
  presentation: DomainPresentation
): { cli: string; curl: string; mcp: string } {
  return { ...DEFAULT_DOCS, ...presentation.docs };
}

/**
 * Domains the panel can present. A domain absent from here has no panel, and a
 * navigation entry may not claim it, `nav.test.ts` and the catalogue coverage
 * test both hold that line, so an unfilled domain fails CI rather than shipping
 * an empty panel.
 */
export const DOMAIN_PRESENTATION: Partial<Record<ApiV1Domain, DomainPresentation>> = {
  assistants: {
    title: "Assistants API",
    mcpTool: "manage_assistants",
    mcpPrompt:
      "List every Assistant in this Organization and tell me which ones are missing a description.",
  },
  flows: {
    title: "Flows API",
    mcpTool: "manage_flows",
    mcpPrompt:
      "List the Flows on this Assistant, then disable any that have no conditions and tell me which ones you turned off.",
  },
  knowledge: {
    title: "Knowledge API",
    mcpTool: "manage_knowledge",
    mcpPrompt:
      "Add https://example.com/help as a knowledge Source, then poll it until it stops processing and tell me what it produced.",
  },
  publish: {
    title: "Publish API",
    mcpTool: "publish_assistant",
    mcpPrompt:
      "Tell me whether this Assistant is published and, if it is, when its live Publication was cut.",
  },
  inbox: {
    title: "Inbox API",
    mcpTool: "read_inbox",
    mcpPrompt:
      "Read the most recent Conversations for this Assistant and summarise what people were asking about.",
  },
  improvements: {
    title: "Improvements API",
    mcpTool: "manage_improvements",
    mcpPrompt:
      "List the Improvements that are still to do and raise the priority of any that have happened more than once.",
  },
  entities: {
    title: "Entities API",
    mcpTool: "manage_entities",
    mcpPrompt:
      "Show me the Entities in this Organization and how many Records each one holds.",
  },
  memories: {
    title: "Memory API",
    mcpTool: "manage_memories",
    mcpPrompt:
      "Tell me whether long-term memory is enabled, and list the subjects that have Memories stored.",
  },
  sso: {
    title: "SSO API",
    mcpTool: "manage_sso",
    mcpPrompt:
      "Validate the SSO connection and tell me which claim carries the Visitor identity.",
  },
  "help-desks": {
    title: "Help Desks API",
    mcpTool: "manage_help_desks",
    mcpPrompt:
      "List the Help Desks with their escalation channels, and flag any desk that has no channel configured.",
  },
  skills: {
    title: "Skills API",
    mcpTool: "manage_configuration",
    mcpPrompt:
      "List the Organization's Skills and tell me which ones this Assistant has attached.",
  },
  goals: {
    title: "Goals API",
    mcpTool: "manage_configuration",
    mcpPrompt:
      "List this Assistant's standing Goals and tell me which ones are quarantined.",
  },
  alerts: {
    title: "Alerts API",
    mcpTool: "manage_configuration",
    mcpPrompt:
      "List the Alerts that still need attention and summarise what is broken.",
  },
  organization: {
    title: "Organization API",
    mcpTool: "manage_organization",
    mcpPrompt:
      "Show the Organization settings and tell me which ones are still on their defaults.",
  },
  members: {
    title: "Members API",
    mcpTool: "manage_organization",
    mcpPrompt:
      "List the Members with their Roles, and tell me who can administer this Organization.",
  },
  // Not "API Keys API": the title names what you are looking at, and the
  // pattern is not worth a stutter.
  "api-keys": {
    title: "API Keys",
    mcpTool: "manage_organization",
    mcpPrompt:
      "List this Organization's API keys with the Role each one carries, and tell me which have never been used.",
  },
  "api-integrations": {
    title: "API Integrations",
    mcpTool: "manage_integrations",
    mcpPrompt:
      "Show this Assistant's API integration and list the endpoints it is allowed to call.",
  },
  providers: {
    title: "Providers API",
    mcpTool: "manage_integrations",
    mcpPrompt:
      "List the Provider Connections and tell me which one serves embeddings.",
  },
};
