import { describe, expect, it } from "vitest";
import { openApiBaseUrl, resolveOpenApiOperation, templatizePath } from "./openapi";

/**
 * Resolving an operation is a fact about the document (#837), so these are the
 * whole contract: the two document dialects an organization is likely to
 * publish, what each of them means by "where the API lives", and the three
 * ways a resolution fails.
 */

const DOC_URL = "https://acme.test/openapi/spec.json";

const v3 = {
  openapi: "3.0.0",
  servers: [{ url: "https://api.acme.test/v1" }],
  paths: {
    "/refunds": {
      post: { operationId: "createRefund" },
      get: { operationId: "listRefunds" },
    },
    "/refunds/{refundId}": { get: { operationId: "getRefund" } },
  },
};

const v2 = {
  swagger: "2.0",
  host: "api.acme.test",
  basePath: "/v2",
  schemes: ["https"],
  paths: { "/orders": { get: { operationId: "listOrders" } } },
};

describe("where the document says the API lives", () => {
  it("takes the first OpenAPI 3 server", () => {
    expect(openApiBaseUrl(v3, DOC_URL)).toBe("https://api.acme.test/v1");
  });

  it("assembles a Swagger 2 base from scheme, host and basePath", () => {
    expect(openApiBaseUrl(v2, DOC_URL)).toBe("https://api.acme.test/v2");
  });

  it("resolves a relative server against the document's own location", () => {
    // "servers: [{ url: '/v3' }]" means "this host", and the only host known
    // is the one the document was fetched from.
    expect(openApiBaseUrl({ servers: [{ url: "/v3" }] }, DOC_URL)).toBe(
      "https://acme.test/v3"
    );
  });

  it("falls back to the document's own location when it names no server", () => {
    expect(openApiBaseUrl({ paths: {} }, DOC_URL)).toBe("https://acme.test/openapi/");
  });

  it("has nothing to say about a document that is not one", () => {
    expect(openApiBaseUrl(null, DOC_URL)).toBeNull();
    expect(openApiBaseUrl("{}", DOC_URL)).toBeNull();
    expect(openApiBaseUrl([], DOC_URL)).toBeNull();
  });
});

describe("resolving an operation", () => {
  it("finds the method and the absolute URL", () => {
    expect(resolveOpenApiOperation(v3, "createRefund", DOC_URL)).toEqual({
      ok: true,
      operation: { method: "POST", url: "https://api.acme.test/v1/refunds" },
    });
    // Two operations on one path: the method is whichever one carries the id.
    expect(resolveOpenApiOperation(v3, "listRefunds", DOC_URL)).toMatchObject({
      operation: { method: "GET" },
    });
    expect(resolveOpenApiOperation(v2, "listOrders", DOC_URL)).toEqual({
      ok: true,
      operation: { method: "GET", url: "https://api.acme.test/v2/orders" },
    });
  });

  it("keeps a basePath that a leading slash would otherwise discard", () => {
    // `new URL("/orders", "https://h/v2")` is "https://h/orders": the join has
    // to be by hand, or every Swagger 2 document loses its basePath.
    expect(resolveOpenApiOperation(v2, "listOrders", DOC_URL)).toMatchObject({
      operation: { url: "https://api.acme.test/v2/orders" },
    });
  });

  it("turns a path parameter into a template variable the Flow can fill", () => {
    // `{refundId}` unfilled would send a literal brace; `{{refundId}}` is
    // something an earlier action's extracted variable can answer.
    expect(resolveOpenApiOperation(v3, "getRefund", DOC_URL)).toMatchObject({
      operation: { url: "https://api.acme.test/v1/refunds/{{refundId}}" },
    });
    expect(templatizePath("/a/{x}/b/{y}")).toBe("/a/{{x}}/b/{{y}}");
    expect(templatizePath("/plain")).toBe("/plain");
  });

  it("says which of the three things went wrong", () => {
    expect(resolveOpenApiOperation(v3, "nope", DOC_URL)).toEqual({
      ok: false,
      error: "no_operation",
    });
    expect(resolveOpenApiOperation(v3, "  ", DOC_URL)).toEqual({
      ok: false,
      error: "no_operation",
    });
    expect(resolveOpenApiOperation({ paths: "not an object" }, "x", DOC_URL)).toEqual({
      ok: false,
      error: "unreadable",
    });
    expect(resolveOpenApiOperation(null, "x", DOC_URL)).toEqual({
      ok: false,
      error: "unreadable",
    });
    // A document whose own location cannot be parsed cannot vouch for any
    // host, so even an absolute server URL is refused as foreign.
    expect(
      resolveOpenApiOperation(v3, "createRefund", "not a url")
    ).toEqual({ ok: false, error: "foreign_origin" });
    expect(
      resolveOpenApiOperation({ paths: { "/a": { get: { operationId: "a" } } } }, "a", "not a url")
    ).toEqual({ ok: false, error: "no_server" });
  });

  it("refuses a definition that places the API on another site", () => {
    // The step's auth header travels with the request; a definition that could
    // name any host would send it there. A sibling host on the same site is
    // the developer-portal case and is allowed (the fixtures above rely on it).
    const foreign = { ...v3, servers: [{ url: "https://collector.evil.example/v1" }] };
    expect(resolveOpenApiOperation(foreign, "createRefund", DOC_URL)).toEqual({
      ok: false,
      error: "foreign_origin",
    });
    const downgraded = { ...v3, servers: [{ url: "http://api.acme.test/v1" }] };
    expect(resolveOpenApiOperation(downgraded, "createRefund", DOC_URL)).toEqual({
      ok: false,
      error: "foreign_origin",
    });
    expect(
      resolveOpenApiOperation({ ...v3, servers: [{ url: "/v1" }] }, "createRefund", DOC_URL)
    ).toMatchObject({ ok: true, operation: { url: "https://acme.test/v1/refunds" } });
  });
});
