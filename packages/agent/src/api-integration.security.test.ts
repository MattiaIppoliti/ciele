import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import { sealSecret, type ApiEndpointSpec, type ApiIntegration } from "@agent-hub/core";
import { egressFetch, EgressPolicyError } from "./egress";
import { queryApiEndpoint, resolveIntegrationUrl } from "./api-integration";

/**
 * Egress containment for the API catalogue integration (spec #559). The
 * property under test is an ordering one: **a path the catalogue does not
 * describe never reaches the network at all**, so every refusal below must show
 * `egressFetch` was not called, not merely that the result was an error.
 */

const egressFetchMock = vi.mocked(egressFetch);

const ENDPOINTS: ApiEndpointSpec[] = [
  {
    id: "e1",
    name: "Ticket comments",
    path: "/tickets/{ticketId}/comments",
    method: "GET",
    purpose: "The comments on one ticket.",
  },
  {
    id: "e2",
    name: "Escalate ticket",
    path: "/tickets/{ticketId}/escalate",
    method: "POST",
    purpose: "Escalates one ticket.",
  },
];

function integration(over: Partial<ApiIntegration> = {}): ApiIntegration {
  return {
    assistantId: "a1",
    organizationId: "o1",
    name: "Service desk API",
    baseUrl: "https://api.example.com/v1",
    authType: "none",
    authHeaderName: "",
    authUsername: "",
    encryptedCredential: null,
    endpoints: ENDPOINTS,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...over,
  };
}

function ok(text: string, status = 200) {
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(),
      text,
    },
    finalUrl: "https://api.example.com/",
  };
}

describe("queryApiEndpoint, nothing undescribed reaches the network", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok("{}") as never);
  });

  it("prepends the base URL server-side and keeps the base path", async () => {
    const outcome = await queryApiEndpoint(integration(), {
      path: "/tickets/8317/comments",
    });
    expect(outcome.ok).toBe(true);
    expect(egressFetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/tickets/8317/comments"
    );
    expect(egressFetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it.each([
    ["an undescribed path", "/tickets/8317/audit-log", "unknown_endpoint"],
    ["an absolute URL", "https://evil.example/x", "absolute"],
    ["the cloud metadata address", "http://169.254.169.254/latest", "absolute"],
    ["a protocol-relative host", "//evil.example/tickets/1/comments", "absolute"],
    ["directory traversal", "/tickets/../../../etc/passwd", "traversal"],
    ["an unsubstituted placeholder", "/tickets/{ticketId}/comments", "missing_path_param"],
    ["an encoded dot segment", "/%2e%2e/tickets", "traversal"],
    ["an upper-case encoded dot segment", "/%2E%2E/admin", "traversal"],
    ["a half-encoded dot segment", "/.%2e/internal", "traversal"],
    ["an empty path", "", "empty"],
  ])("refuses %s before any request", async (_label, path, reason) => {
    const outcome = await queryApiEndpoint(integration(), { path });
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(outcome.errorCode).toBe(reason);
    expect(outcome.requestUrl).toBeNull();
    expect(outcome.status).toBeNull();
  });

  it("refuses a described path called with a method it does not declare", async () => {
    const outcome = await queryApiEndpoint(integration(), {
      path: "/tickets/8317/escalate",
      method: "GET",
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(outcome.errorCode).toBe("method_mismatch");
  });

  it("uses the endpoint's declared method, not one the model asks for", async () => {
    await queryApiEndpoint(integration(), {
      path: "/tickets/8317/escalate",
      method: "POST",
      body: { score: 1 },
    });
    expect(egressFetchMock.mock.calls[0][1].method).toBe("POST");
    expect(egressFetchMock.mock.calls[0][1].body).toBe('{"score":1}');
  });

  it("refuses a catalogue whose own entry would escape the base path", async () => {
    const outcome = await queryApiEndpoint(
      integration({
        endpoints: [
          {
            id: "bad",
            name: "Escaping",
            path: "/../../admin",
            method: "GET",
            purpose: "Should never be reachable.",
          },
        ],
      }),
      { path: "/../../admin" }
    );
    expect(egressFetchMock).not.toHaveBeenCalled();
    // Refused by the path check first; either way, nothing went out.
    expect(outcome.errorCode).toBe("traversal");
  });

  it("keeps a query parameter out of the path decision", async () => {
    await queryApiEndpoint(integration(), {
      path: "/tickets/8317/comments?admin=1",
      query: { limit: 5 },
    });
    const url = new URL(egressFetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1/tickets/8317/comments");
    // The model's own query string is dropped; only declared params are set.
    expect(url.searchParams.get("admin")).toBeNull();
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("sends the sealed credential as a header and never returns it", async () => {
    const outcome = await queryApiEndpoint(
      integration({
        authType: "bearer",
        encryptedCredential: sealSecret("desk-t0ken"),
      }),
      { path: "/tickets/8317/comments" }
    );
    expect(egressFetchMock.mock.calls[0][1].headers?.authorization).toBe(
      "Bearer desk-t0ken"
    );
    expect(JSON.stringify(outcome)).not.toContain("desk-t0ken");
  });

  it("puts an api_key credential in the configured header", async () => {
    await queryApiEndpoint(
      integration({
        authType: "api_key",
        authHeaderName: "x-api-key",
        encryptedCredential: sealSecret("k-123"),
      }),
      { path: "/tickets/8317/comments" }
    );
    expect(egressFetchMock.mock.calls[0][1].headers?.["x-api-key"]).toBe("k-123");
  });

  it("reports a real failure status as a completed call, not a refusal", async () => {
    egressFetchMock.mockResolvedValueOnce(ok("upstream boom", 500) as never);
    const outcome = await queryApiEndpoint(integration(), {
      path: "/tickets/8317/comments",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(500);
    expect(outcome.bodyText).toBe("upstream boom");
    expect(outcome.errorCode).toBeNull();
  });

  it("maps an egress policy block to one uniform code, never an address", async () => {
    egressFetchMock.mockRejectedValueOnce(
      new EgressPolicyError("private address", "blocked_address")
    );
    const outcome = await queryApiEndpoint(integration(), {
      path: "/tickets/8317/comments",
    });
    expect(outcome.errorCode).toBe("blocked_host");
    expect(JSON.stringify(outcome)).not.toMatch(/169\.254|private address/);
  });

  it("maps a transport failure (timeout) to `network`", async () => {
    egressFetchMock.mockRejectedValueOnce(new Error("The operation timed out"));
    const outcome = await queryApiEndpoint(integration(), {
      path: "/tickets/8317/comments",
    });
    expect(outcome.errorCode).toBe("network");
    expect(outcome.status).toBeNull();
  });
});

describe("resolveIntegrationUrl", () => {
  it("refuses a base URL that is not http(s)", () => {
    expect(resolveIntegrationUrl("file:///etc", "/x")).toEqual({
      ok: false,
      code: "base_url",
    });
    expect(resolveIntegrationUrl("not a url", "/x")).toEqual({
      ok: false,
      code: "base_url",
    });
  });

  it("keeps the resolved URL inside the configured base", () => {
    const resolved = resolveIntegrationUrl("https://h.example/api/", "/a/b");
    expect(resolved.ok && resolved.url.toString()).toBe("https://h.example/api/a/b");
  });
});

/**
 * A server-pinned path parameter is what stops the model choosing WHOSE record
 * an endpoint reads. When the pin cannot resolve (an SSO connection with no
 * identity claim configured, or a token that omitted it), the endpoint must
 * become uncallable, never model-fillable: leaving `{name}` in the template
 * handed the model the very value the pin exists to take away from it, and
 * `resolveCatalogPath` would then match a model-supplied path against it.
 */
describe("unresolvable identity-pinned path parameters", () => {
  const pinned = (): ApiIntegration =>
    integration({
      endpoints: [
        {
          id: "p1",
          name: "My record",
          path: "/customers/{email}",
          method: "GET",
          purpose: "The signed-in user's own record.",
          params: [
            {
              name: "email",
              in: "path",
              type: "string",
              required: true,
              value: "{{identity.claim}}",
            },
          ],
        },
      ],
    });

  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok("{}") as never);
  });

  it("substitutes the pin when the claim is present", async () => {
    const outcome = await queryApiEndpoint(
      pinned(),
      { path: "/customers/{email}" },
      undefined,
      { subjectId: "sub-1", claimValue: "me@example.com" }
    );
    expect(outcome.ok).toBe(true);
    expect(egressFetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/customers/me%40example.com"
    );
  });

  it("refuses a model-chosen value even when the claim is present", async () => {
    const outcome = await queryApiEndpoint(
      pinned(),
      { path: "/customers/victim@example.com" },
      undefined,
      { subjectId: "sub-1", claimValue: "me@example.com" }
    );
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
  });

  it.each([
    ["no claim value", { subjectId: "sub-1", claimValue: null }],
    ["no identity at all", undefined],
  ])(
    "makes the endpoint uncallable with %s, rather than model-fillable",
    async (_label, identity) => {
      const outcome = await queryApiEndpoint(
        pinned(),
        { path: "/customers/victim@example.com" },
        undefined,
        identity ?? undefined
      );
      expect(egressFetchMock).not.toHaveBeenCalled();
      expect(outcome.errorCode).toBe("unknown_endpoint");
      expect(outcome.requestUrl).toBeNull();
    }
  );
});
