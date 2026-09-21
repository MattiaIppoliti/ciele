import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEndpointSpec, ApiIntegration } from "@agent-hub/core";
import { endpointIdempotencyKey } from "@agent-hub/core";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import { egressFetch } from "./egress";
import { queryApiEndpoint } from "./api-integration";

/**
 * Idempotency keys on catalogued endpoints (#901).
 *
 * The gap this closes: a POST from a Flow into an organization's own API
 * carried no idempotency key at all on this path, so the only thing between a
 * retry and a duplicated write was that nothing retried it. `retries: 0` on a
 * compiled step is a correct guard and the only one, which makes it a single
 * point of failure for every write a Flow makes into a customer's system.
 */

const egressFetchMock = vi.mocked(egressFetch);

function ok(text = "{}") {
  return {
    response: {
      status: 200,
      ok: true,
      headers: new Headers(),
      text,
    },
    finalUrl: "https://api.example.com/tickets",
  };
}

function integration(endpoint: Partial<ApiEndpointSpec>): ApiIntegration {
  return {
    assistantId: "assistant-1",
    organizationId: "org-1",
    name: "Helpdesk",
    baseUrl: "https://api.example.com",
    authType: "none",
    authHeaderName: "",
    authUsername: "",
    encryptedCredential: null,
    endpoints: [
      {
        id: "create-ticket",
        name: "Create ticket",
        path: "/tickets",
        method: "POST",
        purpose: "Open a ticket",
        ...endpoint,
      } as ApiEndpointSpec,
    ],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

const origin = { conversationId: "conv-1", callSlot: "call-7" };

function sentRequest() {
  const [, init] = egressFetchMock.mock.calls.at(-1) as [
    string,
    { headers: Record<string, string>; body?: string },
  ];
  return init;
}

beforeEach(() => {
  egressFetchMock.mockReset();
  egressFetchMock.mockResolvedValue(ok() as never);
});

describe("an endpoint that declares a header", () => {
  it("sends the key under the organization's own header name", async () => {
    // Never guessed. The runtime has always sent a hardcoded `idempotency-key`
    // on the api_request Flow Action, which protects an organization whose API
    // reads that exact spelling and silently protects nobody else.
    await queryApiEndpoint(
      integration({ idempotency: { in: "header", name: "X-Request-Id" } }),
      { path: "/tickets", method: "POST", body: { subject: "printer" } },
      undefined,
      undefined,
      origin
    );
    const { headers } = sentRequest();
    expect(headers["X-Request-Id"]).toBe(
      endpointIdempotencyKey({ ...origin, endpointId: "create-ticket" })
    );
    // And nothing under the name we used to guess.
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("sends the same key for the same slot, twice over the wire", async () => {
    // Named for what it asserts. It drives the real request path twice and
    // compares what left, which is the wire-level half of "a retry presents
    // the value the API already saw"; that the DERIVATION is stable is the
    // core test's job, and whether a given caller reuses the slot is the
    // caller's (see the origin note in `api-catalog-tools.ts`).
    const config = integration({
      idempotency: { in: "header", name: "X-Request-Id" },
    });
    const call = () =>
      queryApiEndpoint(
        config,
        { path: "/tickets", method: "POST", body: { subject: "printer" } },
        undefined,
        undefined,
        origin
      );
    await call();
    const first = sentRequest().headers["X-Request-Id"];
    await call();
    expect(sentRequest().headers["X-Request-Id"]).toBe(first);
  });

  it("sends a different key for a different call in the same Conversation", async () => {
    // Two calls are two writes. Collapsing them would tell a Member their
    // second order duplicated their first.
    const config = integration({
      idempotency: { in: "header", name: "X-Request-Id" },
    });
    await queryApiEndpoint(config, { path: "/tickets", method: "POST", body: {} }, undefined, undefined, origin);
    const first = sentRequest().headers["X-Request-Id"];
    await queryApiEndpoint(
      config,
      { path: "/tickets", method: "POST", body: {} },
      undefined,
      undefined,
      { ...origin, callSlot: "call-8" }
    );
    expect(sentRequest().headers["X-Request-Id"]).not.toBe(first);
  });
});

describe("an endpoint that declares a body field", () => {
  it("merges the key into the JSON body and leaves the rest alone", async () => {
    await queryApiEndpoint(
      integration({ idempotency: { in: "body", name: "request_id" } }),
      { path: "/tickets", method: "POST", body: { subject: "printer" } },
      undefined,
      undefined,
      origin
    );
    const { headers, body } = sentRequest();
    expect(JSON.parse(body as string)).toEqual({
      subject: "printer",
      request_id: endpointIdempotencyKey({ ...origin, endpointId: "create-ticket" }),
    });
    expect(headers["request_id"]).toBeUndefined();
  });

  it("overwrites a value the model put under that field", async () => {
    // The body is the MODEL's, and the model's input can be steered by content
    // it just read. Deferring to a value it supplied would let a crafted page
    // replay an earlier write's key and receive that write's response, or pin
    // a constant and defeat deduplication entirely. The key is ours; where it
    // goes is the catalogue's; neither is the model's to choose.
    await queryApiEndpoint(
      integration({ idempotency: { in: "body", name: "request_id" } }),
      {
        path: "/tickets",
        method: "POST",
        body: { request_id: "replayed-from-an-earlier-write", subject: "printer" },
      },
      undefined,
      undefined,
      origin
    );
    expect(JSON.parse(sentRequest().body as string)).toEqual({
      subject: "printer",
      request_id: endpointIdempotencyKey({ ...origin, endpointId: "create-ticket" }),
    });
  });
});

describe("an endpoint that declares nothing", () => {
  it("sends the same request whether or not a call slot was named", async () => {
    // The acceptance criterion is "no request shape change" for an endpoint
    // that declares nothing. Named for what it can actually check: an
    // undeclared endpoint is unaffected by the one input #901 added, which is
    // the whole of the change on that path. A literal comparison against
    // pre-#901 bytes is not something a test in this tree can make.
    const undeclared = integration({});
    await queryApiEndpoint(
      undeclared,
      { path: "/tickets", method: "POST", body: { subject: "printer" } },
      undefined,
      undefined,
      origin
    );
    const withOrigin = sentRequest();
    egressFetchMock.mockClear();
    await queryApiEndpoint(undeclared, {
      path: "/tickets",
      method: "POST",
      body: { subject: "printer" },
    });
    const withoutOrigin = sentRequest();
    expect(withOrigin.headers).toEqual(withoutOrigin.headers);
    expect(withOrigin.body).toEqual(withoutOrigin.body);
    expect(JSON.parse(withOrigin.body as string)).toEqual({ subject: "printer" });
  });
});

describe("a caller that names no call slot", () => {
  it("sends no key at all, rather than one that collapses two writes", async () => {
    // The builder's test run is exactly this caller: a test must never present
    // the key a real call would, or it burns it and the real call silently
    // gets the test's response back.
    await queryApiEndpoint(
      integration({ idempotency: { in: "header", name: "X-Request-Id" } }),
      { path: "/tickets", method: "POST", body: {} }
    );
    expect(sentRequest().headers["X-Request-Id"]).toBeUndefined();
  });
});

describe("a declaration the editor should have refused", () => {
  it("is ignored at send time, so the key reaches no header at all", async () => {
    // Defence in depth: `setApiIntegrationOp` refuses this, but a row written
    // before that check existed must not be able to replace the integration's
    // sealed credential with a derived hash. Asserted by looking for the key
    // ANYWHERE in the headers, not by looking for an `authorization` that an
    // integration with no credential would not have sent either way.
    const key = endpointIdempotencyKey({ ...origin, endpointId: "create-ticket" });
    for (const name of ["authorization", "host", "content-length"]) {
      egressFetchMock.mockClear();
      await queryApiEndpoint(
        integration({ idempotency: { in: "header", name } }),
        { path: "/tickets", method: "POST", body: {} },
        undefined,
        undefined,
        origin
      );
      const { headers } = sentRequest();
      expect(Object.values(headers)).not.toContain(key);
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(name);
    }
  });
});

describe("a declaration that collides with the credential's own header", () => {
  it("leaves an api_key credential in place rather than replacing it", async () => {
    // `api_key` auth puts the credential under an ADMIN-NAMED header, so the
    // reserved-name list cannot catch this: the name is whatever the admin
    // chose. Replacing it would not leak anything, it would just make every
    // call fail to authenticate while the catalogue entry looked innocent.
    const config = integration({
      idempotency: { in: "header", name: "X-Api-Key" },
    });
    config.authType = "api_key";
    config.authHeaderName = "X-Api-Key";
    config.encryptedCredential = "plaintext-fallback";
    await queryApiEndpoint(
      config,
      { path: "/tickets", method: "POST", body: {} },
      undefined,
      undefined,
      origin
    );
    const { headers } = sentRequest();
    const key = endpointIdempotencyKey({ ...origin, endpointId: "create-ticket" });
    expect(headers["X-Api-Key"]).not.toBe(key);
  });

  it("leaves a pinned parameter header in place too", async () => {
    const config = integration({
      idempotency: { in: "header", name: "X-Tenant" },
      params: [
        { name: "X-Tenant", in: "header", value: "acme" },
      ],
    });
    await queryApiEndpoint(
      config,
      { path: "/tickets", method: "POST", body: {} },
      undefined,
      undefined,
      origin
    );
    expect(sentRequest().headers["X-Tenant"]).toBe("acme");
  });
});
