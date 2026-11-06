/** An Organization's connection to an external Streamable HTTP MCP server. Credentials are stored separately. */
export type McpToolPolicy = "run_freely" | "ask_first" | "off";

export interface RemoteMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  definitionHash: string;
  /** The definition the Admin reviewed. A refresh never updates this approval. */
  approvedHash: string | null;
  policy: McpToolPolicy;
  readOnlyHint: boolean;
  removed: boolean;
}
export type DiscoveredMcpTool = Omit<RemoteMcpTool, "approvedHash" | "policy" | "removed">;

export interface McpServerConnection {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  tools: RemoteMcpTool[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface McpToolSelection {
  serverId: string;
  tools: Array<{ name: string; definitionHash: string }>;
}
export function effectiveMcpToolPolicy(tool: RemoteMcpTool): McpToolPolicy {
  if (tool.removed || tool.definitionHash !== tool.approvedHash) return "off";
  return tool.policy === "run_freely" || tool.policy === "ask_first" ? tool.policy : "off";
}
/** Refresh preserves the decision on the old definition, including removed tools for review. */
export function reconcileMcpTools(previous: RemoteMcpTool[], discovered: DiscoveredMcpTool[]): RemoteMcpTool[] {
  const current = new Set(discovered.map(tool => tool.name));
  return [
    ...discovered.map(tool => {
      const old = previous.find(candidate => candidate.name === tool.name);
      return { ...tool, approvedHash: old?.approvedHash ?? null, policy: old?.policy ?? "off", removed: false };
    }),
    ...previous.filter(tool => !current.has(tool.name)).map(tool => ({ ...tool, removed: true })),
  ];
}
