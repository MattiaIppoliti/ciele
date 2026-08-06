import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { API_V1_ENDPOINTS, buildOpenApiDocument } from "./openapi";

/**
 * The contract drift check (#626): the registry in openapi.ts and the route
 * files on disk must describe the same surface. Shipping a route without
 * registering it — or registering one that doesn't exist — fails here, so
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
