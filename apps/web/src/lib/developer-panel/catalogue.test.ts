import { describe, expect, it } from "vitest";
import { API_V1_DOMAINS } from "@/lib/api-v1/meta";
import { API_V1_ENDPOINTS } from "@/lib/api-v1/openapi";
import { buildPanelDomains, presentableDomains } from "./catalogue";
import { DOMAIN_PRESENTATION } from "./domains";

/**
 * Catalogue coverage (#755): a page can only claim a domain the panel can
 * actually present, and a presented domain must have something to show. Without
 * this, adding an /api/v1 domain ships an empty panel instead of failing CI.
 */

describe("every domain is presentable", () => {
  it("covers all 18 advertised domains", () => {
    const presented = new Set(presentableDomains());
    expect(API_V1_DOMAINS.filter((domain) => !presented.has(domain))).toEqual([]);
  });

  it("presents nothing the deployment does not advertise", () => {
    const advertised = new Set<string>(API_V1_DOMAINS);
    expect(presentableDomains().filter((d) => !advertised.has(d))).toEqual([]);
  });

  it("gives every presented domain at least one operation", () => {
    const empty = presentableDomains().filter(
      (domain) => buildPanelDomains([domain]).length === 0
    );
    expect(empty).toEqual([]);
  });

  it("gives every domain endpoint both a CLI and an MCP template", () => {
    // An operation may deliberately lack one surface, and the panel says so in
    // words, but nothing lacks both silently, and today nothing lacks either.
    const gaps = API_V1_ENDPOINTS.filter(
      (endpoint) => endpoint.domain && (!endpoint.cli || !endpoint.mcp)
    ).map(
      (endpoint) =>
        `${endpoint.method} ${endpoint.path}: missing ${!endpoint.cli ? "cli" : "mcp"}`
    );
    expect(gaps).toEqual([]);
  });

  it("declares a capability on every domain endpoint", () => {
    const missing = API_V1_ENDPOINTS.filter(
      (endpoint) => endpoint.domain && !endpoint.capability
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(missing).toEqual([]);
  });
});

describe("the built catalogue", () => {
  it("keeps the order the page asked for", () => {
    const built = buildPanelDomains(["skills", "api-integrations"]);
    expect(built.map((domain) => domain.domain)).toEqual([
      "skills",
      "api-integrations",
    ]);
  });

  it("carries the presentation and the operations together", () => {
    const [flows] = buildPanelDomains(["flows"]);
    expect(flows.title).toBe(DOMAIN_PRESENTATION.flows?.title);
    expect(flows.mcpTool).toBe("manage_flows");
    expect(flows.docs.cli).toBe("/developers/cli");
    expect(flows.operations.map((op) => op.id)).toContain("patch /flows/{id}");
  });

  it("renders the deepest real request body without dumping the tree", () => {
    // The Flow router config is the worst case in the whole registry.
    const [flows] = buildPanelDomains(["flows"]);
    const create = flows.operations.find((op) => op.id === "post /assistants/{id}/flows");
    expect(create?.body).toBeTruthy();
    expect(create?.body?.split("\n").length).toBeLessThan(40);
  });

  it("reports idempotency and multipart from the contract", () => {
    const [flows] = buildPanelDomains(["flows"]);
    expect(
      flows.operations.find((op) => op.id === "post /assistants/{id}/flows")?.idempotent
    ).toBe(true);
    const [knowledge] = buildPanelDomains(["knowledge"]);
    expect(
      knowledge.operations.find((op) => op.id === "post /collections/{id}/sources")
        ?.multipart
    ).toEqual(["file"]);
  });
});
