import { describe, expect, it } from "vitest";
import {
  apiCatalogSummary,
  apiEndpointDetail,
  resolveCatalogPath,
  endpointIdempotencyExposure,
  endpointIdempotencyKey,
  validateEndpointIdempotency,
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

describe("percent-encoded dot segments", () => {
  const endpoints = [
    {
      id: "e1",
      name: "One record",
      method: "GET" as const,
      path: "/{collection}/{id}",
      purpose: "Look up one record",
    },
  ];

  /**
   * The WHATWG URL parser counts `%2e` as a dot when it collapses `..`, so a
   * literal-only check let `/%2e%2e/users` match a placeholder here and then
   * collapse to an undescribed path in `new URL()`. The catalogue is the
   * allowlist, and the org's sealed credential rides on the request, so a path
   * it never described must not survive this function.
   */
  it.each([
    "/%2e%2e/users",
    "/%2E%2E/admin",
    "/.%2e/internal",
    "/%2e./internal",
    "/%2e%2e",
  ])("refuses %s as traversal", (path) => {
    const result = resolveCatalogPath(endpoints, path, "GET");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("traversal");
  });

  it("still matches an ordinary two-segment path", () => {
    const result = resolveCatalogPath(endpoints, "/tickets/8317", "GET");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathParams).toEqual({ collection: "tickets", id: "8317" });
    }
  });
});

describe("endpoint idempotency (#901)", () => {
  const endpoint = (over: Partial<ApiEndpointSpec> = {}): ApiEndpointSpec => ({
    id: "create-ticket",
    name: "Create ticket",
    path: "/tickets",
    method: "POST",
    purpose: "Open a support ticket",
    ...over,
  });

  describe("the key", () => {
    it("is the same for the same Conversation and call slot", () => {
      // A retry of the same call, by us, by a durable job, or by anything
      // above us that reissues the request, must present the value the
      // organization's API already saw.
      const args = {
        conversationId: "conv-1",
        callSlot: "action-2",
        endpointId: "create-ticket",
      };
      expect(endpointIdempotencyKey(args)).toBe(endpointIdempotencyKey(args));
    });

    it("differs for a different Conversation, slot or endpoint", () => {
      // Two different calls are two different writes. Collapsing them would
      // tell a Member their second order duplicated their first.
      const base = {
        conversationId: "conv-1",
        callSlot: "action-2",
        endpointId: "create-ticket",
      };
      const keys = new Set([
        endpointIdempotencyKey(base),
        endpointIdempotencyKey({ ...base, conversationId: "conv-2" }),
        endpointIdempotencyKey({ ...base, callSlot: "action-3" }),
        endpointIdempotencyKey({ ...base, endpointId: "create-refund" }),
      ]);
      expect(keys.size).toBe(4);
    });

    it("cannot be forged into another call's key by a crafted id", () => {
      // The parts are percent-encoded before joining, so a conversation id
      // containing the separator cannot impersonate a different slot.
      expect(
        endpointIdempotencyKey({
          conversationId: "conv-1:action-9",
          callSlot: "action-2",
          endpointId: "e",
        })
      ).not.toBe(
        endpointIdempotencyKey({
          conversationId: "conv-1",
          callSlot: "action-9:action-2",
          endpointId: "e",
        })
      );
    });

    it("fits the header cap every implementation shares", () => {
      expect(
        endpointIdempotencyKey({
          conversationId: "c".repeat(400),
          callSlot: "s".repeat(400),
          endpointId: "e".repeat(400),
        }).length
      ).toBeLessThanOrEqual(256);
    });
  });

  describe("the declaration", () => {
    it("accepts a plain header name and a plain body field", () => {
      expect(validateEndpointIdempotency({ in: "header", name: "Idempotency-Key" })).toEqual({ ok: true });
      expect(validateEndpointIdempotency({ in: "body", name: "request_id" })).toEqual({ ok: true });
    });

    it("refuses a header that would overwrite the credential", () => {
      // The declaration is admin-supplied and lands in the same header map as
      // the integration's sealed credential. Naming `authorization` would let
      // an endpoint description replace the credential with a derived hash.
      for (const name of ["authorization", "Authorization", "Cookie", "host"]) {
        expect(validateEndpointIdempotency({ in: "header", name })).toEqual({
          ok: false,
          reason: "reserved_header",
        });
      }
    });

    it("refuses a header name that could split the request", () => {
      for (const name of ["X-Key: injected", "X\nKey", "X Key"]) {
        expect(
          validateEndpointIdempotency({ in: "header", name }).ok
        ).toBe(false);
      }
    });

    it("refuses an empty name and a nested body path", () => {
      expect(validateEndpointIdempotency({ in: "header", name: "   " })).toEqual({
        ok: false,
        reason: "empty_name",
      });
      expect(validateEndpointIdempotency({ in: "body", name: "meta.id" })).toEqual({
        ok: false,
        reason: "illegal_body_field",
      });
    });
  });

  describe("the exposure", () => {
    it("says plainly that an undeclared write is unprotected", () => {
      // #901: "An endpoint declaring no key is documented as unprotected
      // rather than silently treated as safe."
      expect(endpointIdempotencyExposure(endpoint())).toBe("unprotected");
      for (const method of ["PUT", "PATCH", "DELETE"] as const) {
        expect(endpointIdempotencyExposure(endpoint({ method }))).toBe("unprotected");
      }
    });

    it("distinguishes a read, where a replay duplicates nothing", () => {
      expect(endpointIdempotencyExposure(endpoint({ method: "GET" }))).toBe("read_only");
    });

    it("reports a declared endpoint as protected", () => {
      expect(
        endpointIdempotencyExposure(
          endpoint({ idempotency: { in: "header", name: "Idempotency-Key" } })
        )
      ).toBe("protected");
    });
  });
});
