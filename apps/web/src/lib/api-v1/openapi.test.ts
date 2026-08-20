import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import * as ops from "@ciele/ops";
import { API_V1_DOMAINS } from "./meta";
import { API_V1_ENDPOINTS, buildOpenApiDocument } from "./openapi";

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
    expect(doc.components.securitySchemes.apiKey.scheme).toBe("bearer");

    const paths = Object.entries(doc.paths);
    expect(paths.length).toBeGreaterThan(10);
    for (const [path, methods] of paths) {
      expect(path.startsWith("/api/v1/")).toBe(true);
      for (const entry of Object.values(methods) as Array<{
        summary?: string;
        responses?: object;
      }>) {
        expect(entry.summary).toBeTruthy();
        expect(entry.responses).toBeTruthy();
      }
    }

    // Bodies rendered from zod: the create-assistant schema must be real.
    const create = doc.paths["/api/v1/assistants"].post as {
      requestBody: { content: Record<string, { schema: { properties?: object } }> };
    };
    expect(
      create.requestBody.content["application/json"].schema.properties
    ).toHaveProperty("title");

    // Round-trips through JSON (what the route serves).
    expect(() => JSON.stringify(doc)).not.toThrow();
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
