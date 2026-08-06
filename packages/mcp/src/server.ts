import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  /** CIELE_MCP_READ_ONLY=1 — an agent may explore but never write. */
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

export function createCieleMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "ciele", version: "0.1.0" });
  for (const tool of buildTools(options.client)) {
    server.registerTool(
      tool.name,
      {
        description: options.readOnly
          ? `${tool.description} (READ-ONLY mode: mutating actions are refused.)`
          : tool.description,
        inputSchema: tool.schema,
      },
      (args: Record<string, unknown>) => callTool(tool, args ?? {}, options.readOnly)
    );
  }
  return server;
}
