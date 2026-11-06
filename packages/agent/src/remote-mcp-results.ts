import type { HistoryMessage } from "./types";
import { readWindow } from "./windowed-read";

/** Stored output stays separate from transcript text and is bounded again on model use. */
export function approvedMcpResults(content: readonly unknown[]): NonNullable<HistoryMessage["mcpResults"]> {
  return content.flatMap(part => {
    if (!part || typeof part !== "object" || !("type" in part) || part.type !== "mcp_result") return [];
    if (!("handle" in part) || typeof part.handle !== "string" || !("serverTool" in part) || typeof part.serverTool !== "string" || !("body" in part) || typeof part.body !== "string" || part.body.length > 1_048_576) return [];
    return [{ handle: part.handle, serverTool: part.serverTool, body: part.body }];
  });
}

export function approvedMcpResultWindows(results: NonNullable<HistoryMessage["mcpResults"]>): string[] {
  return results.map(result => JSON.stringify({ handle: result.handle, serverTool: result.serverTool, ...readWindow(result.body, 0, 4000), note: "Approved MCP output. Read further windows with mcp_read_result. Do not repeat the approved call." }));
}
