import { describe, expect, it, vi } from "vitest";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { GET as mcpGet, POST as mcpRoute } from "./route";

/**
 * The hosted MCP endpoint (#702) at the route seam: authentication, the two
 * protocol eras, and the tool surface. What a tool *does* once called is
 * covered exhaustively in packages/mcp — this asserts the endpoint in front
 * of them, not the tools behind it.
 */

const URL_ = "http://test.local/api/mcp";

async function mintKey(role: "owner" | "viewer" = "owner") {
  const secret = generateApiKeySecret();
  await getMockDb().createApiKey(DEMO_ORG.id, {
    name: `mcp ${role} key`,
    role,
    secretHash: hashApiKeySecret(secret),
    secretHint: apiKeySecretHint(secret),
    createdBy: DEMO_MEMBER.userId,
  });
  return secret;
}

/** A modern (2026-07-28) request: the per-request `_meta` envelope, no handshake. */
const modern = (secret: string | undefined, method: string, params = {}) =>
  new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": method,
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });

/** A 2025-era request: the `initialize` handshake, no envelope. */
const legacy = (secret: string) =>
  new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  });

/** The handler may answer JSON or SSE; pull the one JSON-RPC payload either way. */
async function payload(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line?.slice(5).trim() ?? "null");
  }
  return JSON.parse(text);
}

describe("POST /api/mcp", () => {
  it("refuses a request with no API key", async () => {
    const response = await mcpRoute(modern(undefined, "tools/list"));
    expect(response.status).toBe(401);
  });

  it("refuses an unknown API key with the same opaque 401", async () => {
    const response = await mcpRoute(modern("ciele_sk_not_a_real_key", "tools/list"));
    expect(response.status).toBe(401);
  });

  it("serves the modern era: server/discover advertises 2026-07-28", async () => {
    const secret = await mintKey();
    const response = await mcpRoute(modern(secret, "server/discover"));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.supportedVersions).toContain("2026-07-28");
    expect(body.result.capabilities.tools).toBeDefined();
    // 2026-07-28 moved server identity into the result `_meta` envelope.
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
      name: "ciele",
      version: "0.1.0",
    });
  });

  it("lists all 14 tools to an authenticated modern client", async () => {
    const secret = await mintKey();
    const response = await mcpRoute(modern(secret, "tools/list"));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.tools).toHaveLength(14);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain(
      "manage_assistants"
    );
  });

  it("still serves a 2025-era client (dual era)", async () => {
    const secret = await mintKey();
    const response = await mcpRoute(legacy(secret));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo).toMatchObject({ name: "ciele" });
  });

  /**
   * The 2026-07-28 result-shape obligations (#701), asserted where they are
   * actually observable — on the wire. `resultType` is SDK-supplied; the cache
   * fields come from the hint `createCieleMcpServer` configures (the SDK's
   * default would be an uncacheable `ttlMs: 0`).
   */
  it("carries the required result-shape fields on tools/list", async () => {
    const secret = await mintKey();
    const body = await payload(await mcpRoute(modern(secret, "tools/list")));

    expect(body.result.resultType).toBe("complete");
    expect(body.result.ttlMs).toBe(60 * 60 * 1000);
    expect(body.result.cacheScope).toBe("private");
  });

  it("advertises no deprecated capability", async () => {
    const secret = await mintKey();
    const body = await payload(await mcpRoute(modern(secret, "server/discover")));

    // Roots, Sampling and Logging are Deprecated as of 2026-07-28; we serve
    // tools only, and this keeps it that way.
    expect(Object.keys(body.result.capabilities)).toEqual(["tools"]);
  });

  /**
   * The loopback is what makes the endpoint configuration-free, so the origin
   * it dials must come from the request being served rather than any constant.
   * Proven by intercepting the outbound call a tool makes.
   */
  it("reaches /api/v1 on the origin it was served from", async () => {
    const secret = await mintKey();
    const outbound: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      outbound.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const request = new Request("https://ciele.your-campus.example/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-method": "tools/call",
          // SEP-2243 requires both routing headers, and the handler validates
          // them against the body — Mcp-Name is the tool being called.
          "mcp-name": "manage_assistants",
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "manage_assistants",
            arguments: { action: "list" },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });
      await mcpRoute(request);

      expect(outbound.length).toBeGreaterThan(0);
      for (const url of outbound) {
        expect(new URL(url).origin).toBe("https://ciele.your-campus.example");
        expect(new URL(url).pathname.startsWith("/api/v1/")).toBe(true);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("answers a 2025-era GET probe rather than crashing", async () => {
    const response = await mcpGet(new Request(URL_, { method: "GET" }));
    // Stateless serving has no SSE stream to open: 405, not a 500.
    expect(response.status).toBe(405);
  });

  it("serves a Viewer key too — read-only is the Role, not the endpoint", async () => {
    const secret = await mintKey("viewer");
    const response = await mcpRoute(modern(secret, "tools/list"));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.tools).toHaveLength(14);
  });
});
