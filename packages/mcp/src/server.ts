import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CieleApiError, CieleClient } from "@ciele/client";
import { ToolInputError, buildTools, type CieleTool } from "./tools.ts";

/**
 * Wires the tool set into an MCP server (#629). One wrapper owns the three
 * cross-cutting behaviors, so no tool can forget them:
 * - read-only mode refuses mutating calls before any request leaves;
 * - ToolInputError / CieleApiError become MCP error results (never throws);
 * - results serialize as one JSON text block.
 */

export interface ServerOptions {
  client: CieleClient;
  /** CIELE_MCP_READ_ONLY=1, an agent may explore but never write. */
  readOnly: boolean;
}

export async function callTool(
  tool: CieleTool,
  args: Record<string, unknown>,
  readOnly: boolean
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const fail = (text: string) => ({
    content: [{ type: "text" as const, text }],
    isError: true,
  });
  if (readOnly && tool.mutates(args)) {
    return fail(
      `Read-only mode: "${tool.name}" action "${String(args.action ?? "")}" would write. Unset CIELE_MCP_READ_ONLY to allow mutations.`
    );
  }
  try {
    const result = await tool.run(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }],
    };
  } catch (error) {
    if (error instanceof ToolInputError) return fail(error.message);
    if (error instanceof CieleApiError) {
      return fail(`${error.status} ${error.code}: ${error.message}`);
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * 2026-07-28 requires `ttlMs`/`cacheScope` on cacheable results and the SDK's
 * conservative default is `ttlMs: 0`, uncacheable. Our tool set is fixed at
 * build time: it cannot change for a running process, only across an upgrade.
 * An hour lets clients cache the list (and their prompt caches hit) while
 * still picking up a deployment within the hour; connected clients get
 * `listChanged` regardless.
 *
 * `private` deliberately, not `public`: the list is org-independent today, but
 * scoping it to the requesting client is what keeps that from becoming a leak
 * if tool availability ever narrows by Role, and a client caches it either
 * way, so `public` would only buy shared-intermediary caching we don't need.
 */
const CACHE_HINT = { ttlMs: 60 * 60 * 1000, cacheScope: "private" } as const;

export function createCieleMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "ciele", version: "0.1.0" },
    { cacheHints: { "tools/list": CACHE_HINT, "server/discover": CACHE_HINT } }
  );
  for (const tool of buildTools(options.client)) {
    server.registerTool(
      tool.name,
      {
        description: options.readOnly
          ? `${tool.description} (READ-ONLY mode: mutating actions are refused.)`
          : tool.description,
        // Tools declare raw shapes; v2 wants a Standard Schema object, so the
        // one wiring site wraps instead of all 14 definitions changing.
        inputSchema: z.object(tool.schema),
      },
      (args: Record<string, unknown>) => callTool(tool, args ?? {}, options.readOnly)
    );
  }
  return server;
}
