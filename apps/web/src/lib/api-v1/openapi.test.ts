import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import * as ops from "@ciele/ops";
import { API_V1_DOMAINS } from "./meta";
import { API_V1_ENDPOINTS, buildOpenApiDocument } from "./openapi";
import responseSchemas from "./response-schemas.generated.json";
import { deriveResponseSchemas } from "../../../scripts/response-schemas";

/**
 * The contract drift check (#626): the registry in openapi.ts and the route
 * files on disk must describe the same surface. Shipping a route without
 * registering it, or registering one that doesn't exist, fails here, so
 * the served OpenAPI document can't silently lag the API.
 */

const API_ROOT = join(__dirname, "..", "..", "app", "api", "v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** apps/web/src/app/api/v1/assistants/[id]/route.ts → "/assistants/{id}" */
function routePath(file: string): string {
  const folder = relative(API_ROOT, join(file, ".."));
  const path = folder
    .split(sep)
    .map((seg) => seg.replace(/^\[(\w+)\]$/, "{$1}"))
    .join("/");
  return `/${path}`;
}

function exportedMethods(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map(
    ([, m]) => m.toLowerCase()
  );
}

describe("OpenAPI contract (#626)", () => {
  it("registry and route files describe the same surface", () => {
    const onDisk = new Set(
      routeFiles(API_ROOT).flatMap((file) =>
        exportedMethods(file).map((m) => `${m} ${routePath(file)}`)
      )
    );
    const registered = new Set(
      API_V1_ENDPOINTS.map((e) => `${e.method} ${e.path}`)
    );
    expect([...onDisk].sort()).toEqual([...registered].sort());
  });

  it("builds a structurally valid, serializable document", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("ciele API");
    expect(doc.servers).toEqual([
      expect.objectContaining({ url: "/" }),
    ]);
    expect(doc.components.securitySchemes.apiKey.scheme).toBe("bearer");
    expect(doc.tags.map((tag) => tag.name)).toEqual(["discovery", ...API_V1_DOMAINS]);

    const paths = Object.entries(doc.paths);
    expect(paths.length).toBeGreaterThan(10);
    const operationIds: string[] = [];
    for (const [path, methods] of paths) {
      expect(path.startsWith("/api/v1/")).toBe(true);
      for (const entry of Object.values(methods) as Array<{
        summary?: string;
        responses?: object;
        tags?: string[];
      }>) {
        expect(entry.summary).toBeTruthy();
        expect(entry.responses).toBeTruthy();
        expect(entry.tags).toHaveLength(1);
      }
      for (const entry of Object.values(methods) as Array<{ operationId?: string }>) {
        expect(entry.operationId).toBeTruthy();
        operationIds.push(entry.operationId!);
      }
    }
    expect(new Set(operationIds).size).toBe(operationIds.length);

    // Bodies rendered from zod: the create-assistant schema must be real.
    const create = doc.paths["/api/v1/assistants"].post as {
      requestBody: { content: Record<string, { schema: { properties?: object } }> };
    };
    expect(
      create.requestBody.content["application/json"].schema.properties
    ).toHaveProperty("title");

    const list = doc.paths["/api/v1/assistants"].get as {
      parameters: Array<{ name: string; in: string }>;
    };
    expect(list.parameters.map((parameter) => `${parameter.in}:${parameter.name}`))
      .toEqual(["query:limit", "query:cursor"]);

    const knowledge = doc.paths["/api/v1/knowledge/sources"].get as {
      parameters: Array<{ name: string }>;
    };
    expect(knowledge.parameters.map((parameter) => parameter.name))
      .toEqual(["kinds", "status", "assistantId", "q", "page", "pageSize"]);

    const publication = doc.paths["/api/v1/assistants/{id}/publish"] as Record<
      string,
      { responses: Record<string, { content?: Record<string, { schema: object }> }> }
    >;
    expect(publication.get.responses["200"].content?.["application/json"].schema)
      .toHaveProperty("oneOf");
    expect(publication.post.responses["201"].content?.["application/json"].schema)
      .toHaveProperty("properties.publicationId");
    expect(publication.delete.responses["204"].content).toBeUndefined();
    expect(publication.get.responses).toHaveProperty("422");
    expect(publication.get.responses).toHaveProperty("401");
    expect(publication.get.responses).not.toHaveProperty("403");
    expect(publication.get.responses).not.toHaveProperty("2XX");
    expect(publication.get.responses).not.toHaveProperty("4XX");

    const csv = doc.paths["/api/v1/knowledge/faqs/export"].get as {
      responses: Record<string, { content: Record<string, object> }>;
    };
    expect(csv.responses["200"].content).toHaveProperty("text/csv");

    const sourceUpload = doc.paths["/api/v1/knowledge/sources"].post as {
      requestBody: { content: Record<string, { schema: { properties: Record<string, unknown>; required?: string[] } }> };
      responses: Record<string, { headers?: Record<string, unknown> }>;
    };
    expect(sourceUpload.requestBody.content["multipart/form-data"].schema.properties)
      .toHaveProperty("file");
    expect(sourceUpload.requestBody.content["multipart/form-data"].schema.properties)
      .toHaveProperty("assistantIds");
    expect(sourceUpload.responses).toHaveProperty("429");
    expect(sourceUpload.responses["429"].headers).toHaveProperty("Retry-After");
    expect(sourceUpload.responses).toHaveProperty("503");

    for (const methods of Object.values(doc.paths)) {
      for (const operation of Object.values(methods) as Array<{
        responses: Record<string, { content?: Record<string, object> }>;
      }>) {
        const success = operation.responses["200"] ?? operation.responses["201"] ?? operation.responses["204"];
        if (operation.responses["204"]) expect(success.content).toBeUndefined();
        else expect(success.content).toBeTruthy();
      }
    }

    // Round-trips through JSON (what the route serves).
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it("keeps the docs download synchronized with the route registry", () => {
    const generated = JSON.parse(readFileSync(join(__dirname, "../../../../docs/src/lib/openapi.generated.json"), "utf8"));
    expect(generated).toEqual(buildOpenApiDocument());
  });

  it(
    "keeps response fields synchronized with the route return types",
    () => {
      expect(responseSchemas).toEqual(deriveResponseSchemas());
    },
    // This builds a TypeScript program for every API route. It runs alongside
    // the rest of the web and agent suites in CI, where 15 seconds is too tight.
    60_000
  );

  it("documents 201 only for routes that actually return it", () => {
    const fromRoutes = new Set<string>();
    for (const file of routeFiles(API_ROOT)) {
      const blocks = readFileSync(file, "utf8").split(/export async function (?=GET|POST|PATCH|PUT|DELETE)/);
      for (const block of blocks.slice(1)) {
        const method = /^(GET|POST|PATCH|PUT|DELETE)/.exec(block)?.[1]?.toLowerCase();
        if (method && /status:\s*(?:outcome\.result\.error\s*\?\s*200\s*:\s*)?201/.test(block)) {
          fromRoutes.add(`${method} ${routePath(file)}`);
        }
      }
    }
    const doc = buildOpenApiDocument();
    const fromContract = new Set(
      API_V1_ENDPOINTS
        .filter((endpoint) => "201" in (doc.paths[`/api/v1${endpoint.path}`][endpoint.method] as {
          responses: Record<string, unknown>;
        }).responses)
        .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    );
    expect(fromContract).toEqual(fromRoutes);
  });
});

/* -------------------------------------------------------------------------- */
/* Capability fidelity (#754)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Developer Panel renders a Role badge from each entry's `capability`, so a
 * wrong one understates or overstates what a key needs, a particularly bad lie,
 * because someone writes a script against it.
 *
 * The truth is not prose: routes call `runApiOperation(request, someOp, …)`, and
 * the operation declares its own capability in `@ciele/ops`. This derives the
 * capability from the ops a route method actually references and compares.
 */

type OpLike = { capability: string; name: string };

function isOperation(value: unknown): value is OpLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OpLike).capability === "string" &&
    typeof (value as OpLike).name === "string"
  );
}

const OP_CAPABILITY = new Map<string, string>(
  Object.entries(ops)
    .filter(([, value]) => isOperation(value))
    .map(([exported, value]) => [exported, (value as OpLike).capability])
);

/** The ops referenced inside one exported method, not the whole file. */
function opsPerMethod(file: string): Map<string, string[]> {
  const text = readFileSync(file, "utf8");
  const blocks = text.split(/export async function (?=GET|POST|PATCH|PUT|DELETE)/);
  const found = new Map<string, string[]>();
  for (const block of blocks.slice(1)) {
    const method = /^(GET|POST|PATCH|PUT|DELETE)/.exec(block)?.[1];
    if (!method) continue;
    const names = [...block.matchAll(/\b([a-zA-Z]+Op)\b/g)]
      .map(([, name]) => name)
      .filter((name) => OP_CAPABILITY.has(name));
    found.set(method.toLowerCase(), [...new Set(names)]);
  }
  return found;
}

describe("Developer Panel contract fields (#754)", () => {
  it("declares a capability that matches the operation the route runs", () => {
    const mismatches: string[] = [];
    for (const file of routeFiles(API_ROOT)) {
      const path = routePath(file);
      const perMethod = opsPerMethod(file);
      for (const [method, names] of perMethod) {
        const entry = API_V1_ENDPOINTS.find(
          (candidate) => candidate.method === method && candidate.path === path
        );
        // A route with no single operation (discovery, multipart branching)
        // cannot be derived from; #755 covers those by hand.
        if (!entry?.capability || names.length !== 1) continue;
        const enforced = OP_CAPABILITY.get(names[0]);
        if (entry.capability !== enforced) {
          mismatches.push(
            `${method} ${path}: declares "${entry.capability}", ${names[0]} enforces "${enforced}"`
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("gives every endpoint a domain the deployment advertises", () => {
    const advertised = new Set<string>(API_V1_DOMAINS);
    // The three discovery endpoints describe the deployment, not a domain.
    const discovery = new Set(["/meta", "/openapi.json", "/whoami"]);
    const wrong = API_V1_ENDPOINTS.filter((endpoint) =>
      discovery.has(endpoint.path)
        ? endpoint.domain !== undefined
        : !endpoint.domain || !advertised.has(endpoint.domain)
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(wrong).toEqual([]);
  });

  it("only ships snippet templates on endpoints that have a domain", () => {
    // A CLI or MCP template on a domainless endpoint could never be rendered.
    const orphaned = API_V1_ENDPOINTS.filter(
      (endpoint) => !endpoint.domain && (endpoint.cli || endpoint.mcp)
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(orphaned).toEqual([]);
  });
});

/**
 * `idempotent` in the registry is a promise to the caller, and the route is
 * what keeps it. The two disagreeing is invisible at runtime — the header is
 * simply ignored, and a retried create makes a second row. `teammates.addRoutine`
 * and `projects.create` shipped with the typed client sending the header against
 * routes that never read it, which is how a Routine (capped at 5, with
 * unattended runs attached) could be created twice by one timeout.
 *
 * Only the registry-to-route leg is asserted here. The client's own
 * `idempotencyKey` arguments are the third party to the promise and are not
 * checked: reading them out of `packages/client` needs a parser, not a regex,
 * and a drift test that matches the wrong thing is worse than none.
 */
describe("Idempotency-Key contract", () => {
  it("every endpoint that claims idempotency actually reads the header", () => {
    const byRoute = new Map<string, string>();
    for (const file of routeFiles(API_ROOT)) byRoute.set(routePath(file), readFileSync(file, "utf8"));

    const broken = API_V1_ENDPOINTS.filter((endpoint) => {
      if (!endpoint.idempotent) return false;
      const text = byRoute.get(endpoint.path);
      return !text?.includes("withIdempotency");
    }).map((e) => `${e.method} ${e.path}`);

    expect(broken).toEqual([]);
  });
});
