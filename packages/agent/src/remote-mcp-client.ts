import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { DiscoveredMcpTool } from "@agent-hub/core";
import { egressFetch, validateEgressTarget } from "./egress";
import { getRuntimeHost } from "./host";
import { raceTimeout } from "./preflight-shadow";
import { redactBearerSecrets } from "./redact";

const MAX_MCP_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;
function policy() {
  const relaxed = getRuntimeHost().allowRelaxedEgress();
  return { allowHttp: relaxed, allowLoopback: relaxed };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function remoteMcpDefinitionHash(definition: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(definition))).digest("hex");
}

/** The SDK handles both protocol eras; all of its HTTP requests share our pinned egress boundary. */
async function withClient<T>(input: { url: string; token: string | null; signal?: AbortSignal }, work: (client: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ciele", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  try {
    const outcome = await raceTimeout(async signal => {
      await validateEgressTarget(input.url, policy());
      signal.throwIfAborted();
      const origin = new URL(input.url).origin;
      const transport = new StreamableHTTPClientTransport(new URL(input.url), {
        ...(input.token ? { requestInit: { headers: { Authorization: `Bearer ${input.token}` } } } : {}),
        fetch: async (url, init) => {
          const request = new Request(url, init);
          // Discovery stays on the registered origin; no token can follow a remote redirect or metadata URL.
          if (new URL(request.url).origin !== origin) throw new Error("MCP discovery left the registered origin");
          signal.throwIfAborted();
          // Standalone notification streams are optional. Each call's POST response is bounded below.
          if (request.method === "GET" && request.headers.get("accept") === "text/event-stream") return new Response(null, { status: 405 });
          const { response } = await egressFetch(request.url, {
            ...policy(), method: request.method, headers: Object.fromEntries(request.headers),
            body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
            timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_MCP_RESPONSE_BYTES, maxRedirects: 0,
            signal: AbortSignal.any([signal, request.signal]),
          });
          return new Response([204, 205, 304].includes(response.status) ? null : response.text, { status: response.status, headers: response.headers });
        },
      });
      await client.connect(transport, { signal, timeout: TIMEOUT_MS });
      return work(client, signal);
    }, { timeoutMs: TIMEOUT_MS, signal: input.signal });
    if (outcome.kind === "timeout") throw new Error("MCP request timed out after 30 seconds");
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  } catch (error) {
    throw new Error(redactBearerSecrets(error instanceof Error ? error.message : "MCP request failed", input.token ?? undefined));
  } finally {
    await client.close();
  }
}

export async function discoverRemoteMcpTools(input: { url: string; token: string | null }): Promise<DiscoveredMcpTool[]> {
  return withClient(input, async (client, signal) => {
    const tools: DiscoveredMcpTool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: TIMEOUT_MS });
      for (const tool of page.tools) {
        // A verbose or hostile server must not echo its credential into public settings.
        if (input.token && JSON.stringify(tool).includes(JSON.stringify(input.token).slice(1, -1))) throw new Error("The MCP server returned its configured credential in a tool definition");
        if (tools.some(item => item.name === tool.name)) throw new Error("The MCP server returned duplicate tool names");
        tools.push({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema, definitionHash: remoteMcpDefinitionHash(tool), readOnlyHint: tool.annotations?.readOnlyHint === true });
        if (tools.length > 200) throw new Error("An MCP server can register at most 200 tools");
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("The MCP server repeated a tool page");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  });
}

export async function callRemoteMcpTool(input: { url: string; token: string | null; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }) {
  return withClient(input, (client, signal) => client.callTool({ name: input.name, arguments: input.arguments }, { signal, timeout: TIMEOUT_MS, maxTotalTimeout: TIMEOUT_MS, resetTimeoutOnProgress: false }));
}
