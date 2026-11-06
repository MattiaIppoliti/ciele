import { expect, it } from "vitest";

/**
 * The hosted MCP endpoint's contract (#702), as one table of cases that every
 * server answering `/api/mcp` must pass: the Next.js route (`route.test.ts`)
 * and the Rust service (`rust-mcp.parity.test.ts`, #1135). Authentication, the
 * two protocol eras, the tool surface and where the tools' calls go. What a
 * tool *does* once called is covered in packages/mcp and by the parity test's
 * every-action comparison.
 */

export interface McpRouteTarget {
  /** POST the request to the endpoint under test. */
  post(request: Request): Promise<Response>;
  /** Send a body-less GET or DELETE to the endpoint under test. */
  probe(method: "GET" | "DELETE"): Promise<Response>;
  /** A working key of this Role in the Organization the endpoint serves. */
  key(role: "owner" | "viewer"): Promise<string>;
  /**
   * Run `send`, and return the URLs of the /api/v1 requests its tools made,
   * with the origin they were configured to reach.
   */
  outbound(send: () => Promise<unknown>): Promise<{ urls: string[]; origin: string }>;
}

const URL_ = "http://test.local/api/mcp";

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** A modern (2026-07-28) request: the per-request `_meta` envelope, no handshake. */
export const modern = (secret: string | undefined, method: string, params = {}, url = URL_) =>
  new Request(url, {
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
      params: { ...params, _meta: META },
    }),
  });

/** A modern `tools/call`: SEP-2243 wants Mcp-Name to match the tool in the body. */
export const toolCall = (secret: string, name: string, args: Record<string, unknown>, url = URL_) => {
  const request = modern(secret, "tools/call", { name, arguments: args }, url);
  request.headers.set("mcp-name", name);
  return request;
};

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
export async function payload(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line?.slice(5).trim() ?? "null");
  }
  return JSON.parse(text);
}

/** Registers the contract's cases in the caller's `describe`. `target` is read per case. */
export function mcpRouteContract(target: () => McpRouteTarget): void {
  it("refuses a request with no API key", async () => {
    const response = await target().post(modern(undefined, "tools/list"));
    expect(response.status).toBe(401);
  });

  it("refuses an unknown API key with the same opaque 401", async () => {
    const response = await target().post(modern("ciele_sk_not_a_real_key", "tools/list"));
    expect(response.status).toBe(401);
  });

  it("serves the modern era: server/discover advertises 2026-07-28", async () => {
    const response = await target().post(modern(await target().key("owner"), "server/discover"));

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

  it("lists all 17 tools to an authenticated modern client", async () => {
    const response = await target().post(modern(await target().key("owner"), "tools/list"));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.tools).toHaveLength(17);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("manage_assistants");
  });

  it("still serves a 2025-era client (dual era)", async () => {
    const response = await target().post(legacy(await target().key("owner")));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo).toMatchObject({ name: "ciele" });
  });

  /**
   * The 2026-07-28 result-shape obligations (#701), asserted where they are
   * actually observable, on the wire. `resultType` is SDK-supplied; the cache
   * fields come from the hint `createCieleMcpServer` configures (the SDK's
   * default would be an uncacheable `ttlMs: 0`).
   */
  it("carries the required result-shape fields on tools/list", async () => {
    const body = await payload(await target().post(modern(await target().key("owner"), "tools/list")));

    expect(body.result.resultType).toBe("complete");
    expect(body.result.ttlMs).toBe(60 * 60 * 1000);
    expect(body.result.cacheScope).toBe("private");
  });

  it("advertises no deprecated capability", async () => {
    const body = await payload(await target().post(modern(await target().key("owner"), "server/discover")));

    // Roots, Sampling and Logging are Deprecated as of 2026-07-28; we serve
    // tools only, and this keeps it that way.
    expect(Object.keys(body.result.capabilities)).toEqual(["tools"]);
  });

  /**
   * #801, CYB-03. The tools forward the caller's own live API key to whatever
   * origin this endpoint dials, so the origin must come from configuration and
   * never from the request: a proxy passing an untrusted `Host` would
   * otherwise have this server post a working Bearer key to the attacker's
   * host. Proven by recording the outbound call a tool makes, from a request
   * whose URL names another host entirely.
   */
  it("dials the configured internal origin, not the Host it was asked on", async () => {
    const secret = await target().key("owner");
    const request = toolCall(
      secret,
      "manage_assistants",
      { action: "list" },
      "https://ciele.your-campus.example/api/mcp"
    );
    const { urls, origin } = await target().outbound(() => target().post(request));

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).origin).toBe(origin);
      expect(new URL(url).pathname.startsWith("/api/v1/")).toBe(true);
    }
  });

  it("answers a 2025-era GET probe rather than crashing", async () => {
    // Stateless serving has no SSE stream to open: 405, not a 500.
    expect((await target().probe("GET")).status).toBe(405);
    expect((await target().probe("DELETE")).status).toBe(405);
  });

  it("serves a Viewer key too, read-only is the Role, not the endpoint", async () => {
    const response = await target().post(modern(await target().key("viewer"), "tools/list"));

    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.result.tools).toHaveLength(17);
  });
}
