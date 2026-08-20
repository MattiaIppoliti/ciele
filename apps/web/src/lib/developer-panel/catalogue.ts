import { z } from "zod";
import type { OperationCapability } from "@ciele/ops";
import { API_V1_ENDPOINTS, type EndpointSpec } from "@/lib/api-v1/openapi";
import type { ApiV1Domain } from "@/lib/api-v1/meta";
import { DOMAIN_PRESENTATION, domainDocs } from "./domains";
import { renderBodyShape } from "./snippets";
import type { PanelCapability, PanelDomain, PanelOperation } from "./types";

/**
 * Builds the Developer Panel's catalogue from the /api/v1 contract registry
 * (#754). Server-only: the registry imports `@ciele/ops`, which the client
 * bundle has no business carrying, so the panel fetches this as plain JSON
 * instead of importing the registry.
 *
 * There is still exactly one list. This module reads it; it does not restate it.
 */

/**
 * The client-side mirror of the capability ladder must stay identical to the
 * ops layer's own union. These two assignments fail to compile the moment
 * either side gains or loses a rung, which is cheaper than a test.
 */
const _capabilityMirrorsOps: PanelCapability = null as unknown as OperationCapability;
const _opsMirrorsCapability: OperationCapability = null as unknown as PanelCapability;
void _capabilityMirrorsOps;
void _opsMirrorsCapability;

function bodyShape(endpoint: EndpointSpec): string | null {
  if (!endpoint.body) return null;
  try {
    return renderBodyShape(
      z.toJSONSchema(endpoint.body, {
        io: "input",
        target: "draft-7",
        unrepresentable: "any",
      })
    );
  } catch {
    // Structured config validated with z.custom has no JSON-Schema form. The
    // cURL tab drops the body rather than printing "{}" as if that were the
    // contract; openapi.json says the same thing, and the panel links to it.
    return null;
  }
}

function panelOperation(endpoint: EndpointSpec): PanelOperation {
  return {
    id: `${endpoint.method} ${endpoint.path}`,
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary,
    // A registry entry with no declared capability is a read at most: every
    // write route runs an operation, and #755 pins each declaration to the
    // capability that operation enforces.
    capability: endpoint.capability ?? "member",
    idempotent: endpoint.idempotent === true,
    cli: endpoint.cli ?? null,
    mcp: endpoint.mcp ?? null,
    body: bodyShape(endpoint),
    multipart: endpoint.multipart ?? null,
  };
}

/**
 * The panel for each requested domain, in the order asked for (which is the
 * order the page's `apiDomains` declares). #753 also says "the order the
 * domain union declares", but its own claim table contradicts that (Settings →
 * AI leads with providers, which the union lists after memories), page order
 * is the deliberate reading, since the first domain also names the button.
 * A domain with no presentation is skipped rather than rendered untitled,
 * `nav.test.ts` stops a page from claiming one, so reaching that branch means
 * a hand-built request.
 */
export function buildPanelDomains(domains: readonly ApiV1Domain[]): PanelDomain[] {
  return domains.flatMap((domain) => {
    const presentation = DOMAIN_PRESENTATION[domain];
    if (!presentation) return [];
    const operations = API_V1_ENDPOINTS.filter(
      (endpoint) => endpoint.domain === domain
    ).map(panelOperation);
    if (operations.length === 0) return [];
    return [
      {
        domain,
        title: presentation.title,
        mcpTool: presentation.mcpTool,
        mcpPrompt: presentation.mcpPrompt,
        docs: domainDocs(presentation),
        operations,
      },
    ];
  });
}

/** Domains the panel can present today, what the coverage test measures. */
export function presentableDomains(): ApiV1Domain[] {
  return Object.keys(DOMAIN_PRESENTATION) as ApiV1Domain[];
}
