import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import { egressFetch, EgressPolicyError } from "./egress";
import { testApiRequest } from "./api-request";
import { registerRuntimeHost, resetRuntimeHost } from "./host";

const egressFetchMock = vi.mocked(egressFetch);

function ok(text: string, status = 200) {
  return {
    response: { status, ok: status >= 200 && status < 300, headers: new Headers(), text },
    finalUrl: "https://api.example.com/",
  };
}

/**
 * A Swagger-sourced step (#837): the definition is fetched first and decides
 * the method and the URL, so what the request looks like is a fact about the
 * document rather than about anything typed into the builder.
 */
describe("an endpoint named in a Swagger definition", () => {
  const SPEC = JSON.stringify({
    openapi: "3.0.0",
    servers: [{ url: "https://api.example.com/v1" }],
    paths: {
      "/refunds": { post: { operationId: "createRefund" } },
      "/refunds/{refundId}": { get: { operationId: "getRefund" } },
    },
  });

  beforeEach(() => {
    egressFetchMock.mockReset();
  });

  it("reads the definition, then calls the operation it names", async () => {
    egressFetchMock
      .mockResolvedValueOnce(ok(SPEC) as never)
      .mockResolvedValueOnce(ok("{}") as never);
    const result = await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://api.example.com/openapi.json",
      operationId: "createRefund",
      // A stale method left on the step: the definition wins, or an operation
      // could be talked into being a verb it does not have.
      method: "GET",
    });
    expect(egressFetchMock.mock.calls[0][0]).toBe("https://api.example.com/openapi.json");
    expect(egressFetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/refunds");
    expect(egressFetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(result.ok).toBe(true);
  });

  it("leaves a path parameter as a template variable for the turn to fill", async () => {
    egressFetchMock
      .mockResolvedValueOnce(ok(SPEC) as never)
      .mockResolvedValueOnce(ok("{}") as never);
    await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://api.example.com/openapi.json",
      operationId: "getRefund",
    });
    // The test run has no value for it, so the placeholder survives to the
    // URL rather than the brace being sent as a literal path segment.
    expect(String(egressFetchMock.mock.calls[1][0])).toContain("refundId");
  });

  it("says which half failed, and never sends the request when the definition did", async () => {
    egressFetchMock.mockResolvedValueOnce(ok("not json") as never);
    const unreadable = await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://api.example.com/openapi.json",
      operationId: "createRefund",
    });
    expect(unreadable.error?.code).toBe("swagger_unreadable");
    expect(egressFetchMock).toHaveBeenCalledTimes(1);

    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValueOnce(ok(SPEC) as never);
    const missing = await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://api.example.com/openapi.json",
      operationId: "notInTheSpec",
    });
    expect(missing.error?.code).toBe("swagger_no_operation");
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a definition that moves the API to another site, so the step's credential stays home", async () => {
    const foreign = JSON.stringify({
      ...JSON.parse(SPEC),
      servers: [{ url: "https://collector.evil.example/v1" }],
    });
    egressFetchMock.mockResolvedValueOnce(ok(foreign) as never);
    const result = await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://api.example.com/openapi.json",
      operationId: "createRefund",
      auth: { type: "bearer", token: "sk-live" },
    });
    expect(result.error?.code).toBe("swagger_foreign_origin");
    expect(result.error?.message).toMatch(/different site/i);
    expect(egressFetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal on the definition as that policy's own refusal", async () => {
    // The definition URL is admin-set and server-fetched, so it is guarded the
    // same way the request is; flattening that into "unreadable" would hide a
    // blocked host behind a spelling mistake.
    egressFetchMock.mockRejectedValueOnce(new EgressPolicyError("blocked", "blocked_host"));
    const result = await testApiRequest({
      endpoint: "swagger",
      swaggerUrl: "https://internal.example.com/openapi.json",
      operationId: "createRefund",
    });
    expect(result.error?.code).toBe("blocked_host");
  });

  it("needs a definition URL before it can do anything", async () => {
    const result = await testApiRequest({ endpoint: "swagger", operationId: "x" });
    expect(result.error?.code).toBe("swagger_unreadable");
    expect(egressFetchMock).not.toHaveBeenCalled();
  });
});

describe("testApiRequest", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok("{}") as never);
  });

  it("runs with distinguishable sample values for template variables", async () => {
    await testApiRequest({
      method: "GET",
      url: "https://api.example.com/users/{{user.id}}",
    });
    // Sample values are wrapped in guillemets so they can't be mistaken for real data.
    expect(egressFetchMock.mock.calls[0][0]).toBe(
      `https://api.example.com/users/${encodeURIComponent("«user.id»")}`
    );
  });

  it("returns status, a bounded excerpt and extracted values on success", async () => {
    egressFetchMock.mockResolvedValueOnce(ok('{"data":{"id":"42"}}') as never);
    const result = await testApiRequest({
      method: "POST",
      url: "https://api.example.com/",
      jsonPaths: [{ id: "j1", path: "$.data.id", variable: "id" }],
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.excerpt).toBe('{"data":{"id":"42"}}');
    expect(result.extracted).toEqual([{ variable: "id", value: "42", missed: false }]);
    expect(result.error).toBeNull();
  });

  it("defaults to the strict egress posture, no HTTP, no loopback, unless the host relaxes it", async () => {
    // The environment is a host fact behind the `allowRelaxedEgress` port
    // (#577): unwired means strict, and only an explicit registration relaxes.
    try {
      await testApiRequest({ method: "GET", url: "https://api.example.com/" });
      expect(egressFetchMock.mock.calls[0][1]).toMatchObject({
        allowHttp: false,
        allowLoopback: false,
      });

      registerRuntimeHost({ allowRelaxedEgress: () => true });
      await testApiRequest({ method: "GET", url: "https://api.example.com/" });
      expect(egressFetchMock.mock.calls[1][1]).toMatchObject({
        allowHttp: true,
        allowLoopback: true,
      });
    } finally {
      resetRuntimeHost();
    }
  });

  it("never returns the auth secret in the result", async () => {
    egressFetchMock.mockResolvedValueOnce(ok("{}") as never);
    const result = await testApiRequest({
      method: "POST",
      url: "https://api.example.com/",
      auth: { type: "bearer", token: "s3cret-token" },
    });
    expect(JSON.stringify(result)).not.toContain("s3cret-token");
    // ...but the secret was composed into the outbound request.
    expect(egressFetchMock.mock.calls[0][1].headers?.authorization).toBe(
      "Bearer s3cret-token"
    );
  });

  it("maps a policy block to a human message + code, never a resolved IP", async () => {
    egressFetchMock.mockRejectedValueOnce(
      new EgressPolicyError("Private or loopback endpoints are not allowed", "blocked_address")
    );
    const result = await testApiRequest({
      method: "GET",
      url: "https://169.254.169.254/",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blocked_address");
    expect(result.error?.message).toMatch(/private address/i);
    expect(JSON.stringify(result)).not.toMatch(/169\.254/);
  });

  it("rejects a template variable in the URL host", async () => {
    const result = await testApiRequest({
      method: "GET",
      url: "https://{{user.id}}/path",
    });
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("template_in_origin");
  });
});
