import { describe, expect, it } from "vitest";
import { CieleClient } from "@ciele/client";
import { API_V1_ENDPOINTS } from "@/lib/api-v1/openapi";

/**
 * Closes the drift triangle around the /api/v1 contract (#626):
 * `openapi.test.ts` pins registry ↔ route files; this test pins registry ↔
 * `@ciele/client`. Every client method is invoked reflectively against a
 * recording fetch, and each recorded (method, path) must resolve to exactly
 * one registry entry, and every registry entry must be reachable through
 * some client method. Add an endpoint without a client method (or vice
 * versa) and CI fails, instead of the CLI/MCP surface silently lagging the
 * API.
 */

/** Registry entries the client deliberately does not wrap. */
const CLIENT_EXEMPT = new Set<string>([
  // The OpenAPI document is for doc tooling; the client IS the typed contract.
  "GET /openapi.json",
]);

interface RecordedCall {
  method: string;
  path: string;
}

function recordingClient(): { client: CieleClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname.replace(/^\/api\/v1/, ""),
    });
    // One response body that satisfies every reader: pagination sees an
    // exhausted page, list readers see empty data, text readers see JSON text.
    return new Response(JSON.stringify({ data: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    client: new CieleClient({
      apiKey: "ciele_sk_test",
      baseUrl: "https://self.host",
      fetch: fetchImpl,
    }),
    calls,
  };
}

/**
 * Invokes every public client method with positional placeholder strings.
 * Path parameters become "x0"/"x1"; body/query arguments are shape-irrelevant
 * here because only the (method, path) pair is asserted. Async generators
 * (listAll-style) are iterated once so their first page request fires.
 */
async function invokeEverything(client: CieleClient): Promise<string[]> {
  const invoked: string[] = [];
  const groups: Array<[string, unknown]> = [
    ["", client],
    ...Object.entries(client).filter(
      ([, value]) => value && typeof value === "object"
    ),
  ];
  for (const [groupName, group] of groups) {
    const methods =
      groupName === ""
        ? // Top-level methods live on the prototype (meta, whoami).
          Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter(
            (name) =>
              name !== "constructor" &&
              !name.startsWith("request") &&
              name !== "paginate" &&
              typeof (client as unknown as Record<string, unknown>)[name] ===
                "function"
          )
        : Object.keys(group as object);
    for (const name of methods) {
      const fn = (group as Record<string, unknown>)[name];
      if (typeof fn !== "function") continue;
      const args = Array.from({ length: fn.length }, (_, i) => `x${i}`);
      try {
        const result = (fn as (...a: unknown[]) => unknown).call(group, ...args);
        if (
          result &&
          typeof result === "object" &&
          Symbol.asyncIterator in result
        ) {
          // Pull one item so the generator issues its first request.
          await (result as AsyncGenerator<unknown>).next();
        } else {
          await result;
        }
        invoked.push(groupName ? `${groupName}.${name}` : name);
      } catch (error) {
        throw new Error(
          `client method ${groupName ? `${groupName}.` : ""}${name} threw before/while fetching: ${String(error)}`
        );
      }
    }
  }
  return invoked;
}

const registryKey = (method: string, path: string) =>
  `${method.toUpperCase()} ${path}`;

/** "/assistants/{id}/flows" → matcher for "/assistants/x0/flows". */
const matcherOf = (path: string) =>
  new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`);

describe("@ciele/client ↔ /api/v1 registry conformance", () => {
  it("every client request resolves to exactly one registered endpoint, and every registered endpoint is reachable", async () => {
    const { client, calls } = recordingClient();
    await invokeEverything(client);
    expect(calls.length).toBeGreaterThan(80);

    const entries = API_V1_ENDPOINTS.map((endpoint) => ({
      key: registryKey(endpoint.method, endpoint.path),
      method: endpoint.method.toUpperCase(),
      matcher: matcherOf(endpoint.path),
    }));

    const unmatched: string[] = [];
    const covered = new Set<string>();
    for (const call of calls) {
      const hits = entries.filter(
        (entry) => entry.method === call.method && entry.matcher.test(call.path)
      );
      if (hits.length !== 1) {
        unmatched.push(
          `${call.method} ${call.path} (matched ${hits.length} registry entries)`
        );
        continue;
      }
      covered.add(hits[0].key);
    }
    expect(unmatched, "client speaks endpoints the registry does not declare").toEqual([]);

    const uncovered = entries
      .map((entry) => entry.key)
      .filter((key) => !covered.has(key) && !CLIENT_EXEMPT.has(key));
    expect(uncovered, "registered endpoints no client method reaches").toEqual([]);
  });
});
