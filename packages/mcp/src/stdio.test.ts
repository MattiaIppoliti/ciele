import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The stdio process end to end (#629, #700). `serveStdio` decides the era from
 * the opening exchange, so these tests are the only place the wire era is
 * actually observable — a unit test of `createCieleMcpServer` cannot see it.
 *
 * Each case spawns the real ciele-mcp child process, so the wall clock is
 * dominated by process-spawn time, which balloons when turbo runs the web and
 * agent suites concurrently on the same machine. The test timeout is a safety
 * net, not a latency assertion — keep it well above the contended worst case
 * (same rationale as apps/web's local-connector-runtime tests). The connect
 * deadline below stays under it so a genuinely hung spawn fails with a
 * descriptive error instead of a bare vitest timeout.
 */
vi.setConfig({ testTimeout: 90_000 });

const CONNECT_DEADLINE_MS = 60_000;

async function connectWithDeadline(client: Client, transport: StdioClientTransport) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `ciele-mcp stdio process did not complete the opening exchange within ${CONNECT_DEADLINE_MS}ms — the spawn or handshake is hung, not slow`
              )
            ),
          CONNECT_DEADLINE_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A stand-in Ciele API: enough of /api/v1 for `ciele_identity`. */
function startApi(): Promise<{ server: Server; baseUrl: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== "Bearer ciele_sk_stdio_test") {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad key" } }));
    } else if (request.url === "/api/v1/meta") {
      response.end(JSON.stringify({
        api: "ciele",
        apiVersion: 1,
        serverVersion: "stdio-test",
        domains: ["assistants", "providers"],
      }));
    } else if (request.url === "/api/v1/whoami") {
      response.end(JSON.stringify({
        organizationId: "org-stdio",
        role: "viewer",
        keyId: "key-stdio",
      }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No API test port");
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

function spawnServer(baseUrl: string, env: Record<string, string> = {}) {
  return new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, "bin/ciele-mcp.mjs")],
    cwd: packageRoot,
    env: {
      CIELE_API_KEY: "ciele_sk_stdio_test",
      CIELE_BASE_URL: baseUrl,
      CIELE_MCP_READ_ONLY: "1",
      ...env,
    },
    stderr: "pipe",
  });
}

describe("ciele MCP stdio process", () => {
  let api: Awaited<ReturnType<typeof startApi>>;

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      api.server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("serves a 2025-era client, lists every tool, and calls the local Ciele API", async () => {
    const client = new Client({ name: "ciele-stdio-test", version: "1.0.0" });

    try {
      await connectWithDeadline(client, spawnServer(api.baseUrl));
      // No `versionNegotiation` — the v2 client's default is the legacy
      // handshake, which `serveStdio` still serves.
      expect(client.getProtocolEra()).toBe("legacy");
      expect(client.getServerVersion()).toMatchObject({ name: "ciele" });

      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(14);
      expect(listed.tools.map((tool) => tool.name)).toContain("manage_integrations");
      expect(listed.tools[0]?.description).toContain("READ-ONLY mode");

      const result = await client.callTool({ name: "ciele_identity", arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = (result as {
        content: Array<{ type: string; text?: string }>;
      }).content;
      const text = content.find((item) => item.type === "text")?.text;
      expect(JSON.parse(text ?? "null")).toMatchObject({
        meta: { serverVersion: "stdio-test" },
        whoami: { organizationId: "org-stdio", role: "viewer" },
      });
      expect(api.requests.sort()).toEqual(["/api/v1/meta", "/api/v1/whoami"]);
    } finally {
      await client.close();
    }
  });

  it("negotiates the 2026-07-28 era and serves the same tools", async () => {
    const client = new Client(
      { name: "ciele-stdio-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );

    try {
      await connectWithDeadline(client, spawnServer(api.baseUrl));
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");

      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(14);

      const result = await client.callTool({ name: "ciele_identity", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  });

  it("refuses a 2025-era client when CIELE_MCP_MODERN_ONLY is set", async () => {
    const client = new Client({ name: "ciele-stdio-test", version: "1.0.0" });

    await expect(
      client.connect(spawnServer(api.baseUrl, { CIELE_MCP_MODERN_ONLY: "1" }))
    ).rejects.toThrow();
    await client.close();
  });

  it("still serves a modern client when CIELE_MCP_MODERN_ONLY is set", async () => {
    const client = new Client(
      { name: "ciele-stdio-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );

    try {
      await connectWithDeadline(
        client,
        spawnServer(api.baseUrl, { CIELE_MCP_MODERN_ONLY: "1" })
      );
      expect(client.getProtocolEra()).toBe("modern");
      expect((await client.listTools()).tools).toHaveLength(14);
    } finally {
      await client.close();
    }
  });
});
