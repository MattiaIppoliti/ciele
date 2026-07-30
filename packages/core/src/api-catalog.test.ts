import { describe, expect, it } from "vitest";
import {
  apiCatalogSummary,
  apiEndpointDetail,
  resolveCatalogPath,
} from "./api-catalog";
import type { ApiEndpointSpec } from "./types";

const COMMENTS: ApiEndpointSpec = {
  id: "e1",
  name: "Ticket comments",
  path: "/tickets/{ticketId}/comments",
  method: "GET",
  purpose: "The comments on one ticket.",
  params: [
    { name: "ticketId", in: "path", type: "number", description: "ticket identifier" },
    { name: "limit", in: "query", type: "number" },
  ],
  responseKeys: ["items", "total"],
};

const ESCALATE: ApiEndpointSpec = {
  id: "e2",
  name: "Escalate ticket",
  path: "/tickets/{ticketId}/escalate",
  method: "POST",
  purpose: "Escalates one ticket.",
};

const CATALOG = [COMMENTS, ESCALATE];

describe("resolveCatalogPath", () => {
  it("matches a described path and reports the substituted parameters", () => {
    const match = resolveCatalogPath(CATALOG, "/tickets/8317/comments", "GET");
    expect(match).toMatchObject({
      ok: true,
      path: "/tickets/8317/comments",
      pathParams: { ticketId: "8317" },
    });
    expect(match.ok && match.endpoint.id).toBe("e1");
  });

  it("normalizes a missing leading slash and drops the query string", () => {
    const match = resolveCatalogPath(CATALOG, "tickets/9/comments?limit=5");
    expect(match).toMatchObject({ ok: true, path: "/tickets/9/comments" });
  });

  it("refuses a path the catalogue does not describe", () => {
    expect(resolveCatalogPath(CATALOG, "/tickets/8317/audit-log")).toEqual({
      ok: false,
      reason: "unknown_endpoint",
    });
    expect(resolveCatalogPath(CATALOG, "/tickets")).toEqual({
      ok: false,
      reason: "unknown_endpoint",
    });
    expect(resolveCatalogPath([], "/anything")).toEqual({
      ok: false,
      reason: "unknown_endpoint",
    });
  });

  it("refuses an absolute URL, a protocol-relative path, or a backslash", () => {
    for (const path of [
      "https://evil.example/tickets/1/comments",
      "//evil.example/tickets/1/comments",
      "http://169.254.169.254/latest/meta-data",
      "\\\\evil.example\\tickets",
      "file:///etc/passwd",
    ]) {
      expect(resolveCatalogPath(CATALOG, path)).toEqual({
        ok: false,
        reason: "absolute",
      });
    }
  });

  it("refuses traversal, including an encoded slash inside a path parameter", () => {
    expect(resolveCatalogPath(CATALOG, "/tickets/../../admin/comments")).toEqual({
      ok: false,
      reason: "traversal",
    });
    // %2f would decode to a slash server-side, reaching an undescribed path.
    expect(
      resolveCatalogPath(CATALOG, "/tickets/1%2f..%2fadmin/comments")
    ).toEqual({ ok: false, reason: "unknown_endpoint" });
  });

  it("refuses a path that still carries an unsubstituted placeholder", () => {
    expect(resolveCatalogPath(CATALOG, "/tickets/{ticketId}/comments")).toEqual({
      ok: false,
      reason: "missing_path_param",
    });
  });

  it("refuses a described path called with the wrong method", () => {
    expect(resolveCatalogPath(CATALOG, "/tickets/8317/escalate", "GET")).toEqual({
      ok: false,
      reason: "method_mismatch",
    });
    expect(
      resolveCatalogPath(CATALOG, "/tickets/8317/escalate", "POST")
    ).toMatchObject({ ok: true });
  });

  it("refuses an empty path", () => {
    expect(resolveCatalogPath(CATALOG, "  ")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(resolveCatalogPath(CATALOG, "?a=1")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("apiCatalogSummary", () => {
  it("lists every endpoint with its parameter names and response keys", () => {
    const summary = apiCatalogSummary({
      name: "Service desk",
      baseUrl: "https://api.example.com/v1",
      endpoints: CATALOG,
    });
    expect(summary.baseUrl).toBe("https://api.example.com/v1");
    expect(summary.endpoints[0]).toEqual({
      id: "e1",
      name: "Ticket comments",
      method: "GET",
      path: "/tickets/{ticketId}/comments",
      purpose: "The comments on one ticket.",
      pathParams: ["ticketId"],
      queryParams: ["limit"],
      responseKeys: ["items", "total"],
    });
  });
});

describe("apiEndpointDetail", () => {
  it("marks a path parameter required even when the catalogue does not", () => {
    const detail = apiEndpointDetail(COMMENTS);
    expect(detail.parameters).toEqual([
      {
        name: "ticketId",
        in: "path",
        type: "number",
        required: true,
        description: "ticket identifier",
      },
      {
        name: "limit",
        in: "query",
        type: "number",
        required: false,
        description: "",
      },
    ]);
  });

  it("derives path parameters from the template when none are declared", () => {
    expect(apiEndpointDetail(ESCALATE).parameters).toEqual([
      {
        name: "ticketId",
        in: "path",
        type: "string",
        required: true,
        description: "",
      },
    ]);
  });
});
