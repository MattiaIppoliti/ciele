import { z } from "zod";
import { reconcileMcpTools, sealSecret } from "@agent-hub/core";
import { defineOperation, OperationError, type OperationContext } from "./operation";
const id = z.string().min(1).max(200);
const entities = () => [{ kind: "mcpSettings" as const }];
async function requireServer(ctx: OperationContext, serverId: string) {
  const server = await ctx.db.table("mcpServerConnections").get(serverId);
  if (!server || server.organizationId !== ctx.organizationId) throw new OperationError("not_found", "MCP server not found");
  return server;
}
export const listMcpServersOp = defineOperation({
  name: "mcpServers.list", capability: "mcpServers:manage", effect: "read", input: z.object({}), entities: () => [],
  run: async ctx => {
    try { return { available: true, items: await ctx.db.table("mcpServerConnections").list({ organizationId: ctx.organizationId }) }; }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "PGRST205")) return { available: false, items: [] };
      throw error;
    }
  },
});
export const createMcpServerOp = defineOperation({
  name: "mcpServers.create", capability: "mcpServers:manage", effect: "consequential", entities,
  input: z.object({ name: z.string().trim().min(1).max(120), url: z.string().url().max(2000).refine(value => { const url = new URL(value); return !url.username && !url.password; }, "Use a URL without embedded credentials"), token: z.string().trim().min(1).max(16000).optional() }).strict(),
  run: async (ctx, input) => {
    const port = ctx.ports?.remoteMcp;
    if (!port) throw new OperationError("invalid_input", "MCP connections are unavailable on this surface");
    const encryptedToken = input.token ? sealSecret(input.token) : null;
    try {
      const tools = reconcileMcpTools([], await port.discover({ url: input.url, encryptedToken }));
      const connection = await ctx.db.createMcpServerConnection(ctx.organizationId, { name: input.name, url: input.url, encryptedToken, tools });
      await ctx.db.resolveAlertsByKey(ctx.organizationId, `remote-mcp:${input.url}`);
      return connection;
    } catch (error) {
      await ctx.db.raiseAlert(ctx.organizationId, { type: "integration", sourceKey: `remote-mcp:${input.url}`, title: `MCP server unavailable: ${input.name}`, detail: "Ciele could not register this server. Check its URL and credentials, then try again." });
      throw new OperationError("invalid_input", error instanceof Error ? error.message : "MCP connection failed");
    }
  },
});
export const refreshMcpServerOp = defineOperation({
  name: "mcpServers.refresh", capability: "mcpServers:manage", effect: "consequential", input: z.object({ id }), entities,
  run: async (ctx, input) => {
    const server = await requireServer(ctx, input.id);
    if (!ctx.ports?.remoteMcp) throw new OperationError("invalid_input", "MCP connections are unavailable on this surface");
    try {
      const tools = reconcileMcpTools(server.tools, await ctx.ports.remoteMcp.refresh(server.id));
      const updated = await ctx.db.compareAndSetMcpTools(ctx.organizationId, server.id, server.revision, tools);
      if (!updated) throw new OperationError("conflict", "The server changed. Refresh the page and review its tools again.");
      await ctx.db.resolveAlertsByKey(ctx.organizationId, `remote-mcp:${server.url}`);
      return updated;
    } catch (error) {
      await ctx.db.raiseAlert(ctx.organizationId, { type: "integration", sourceKey: `remote-mcp:${server.url}`, title: `MCP server unavailable: ${server.name}`, detail: "Ciele could not refresh this server. Check the server and try again." });
      throw error;
    }
  },
});
export const setMcpToolPolicyOp = defineOperation({
  name: "mcpServers.policy", capability: "mcpServers:manage", effect: "consequential", entities,
  input: z.object({ id, tool: z.string().min(1), definitionHash: z.string().regex(/^[a-f0-9]{64}$/), policy: z.enum(["run_freely", "ask_first", "off"]) }).strict(),
  run: async (ctx, input) => {
    const server = await requireServer(ctx, input.id);
    const tool = server.tools.find(tool => tool.name === input.tool);
    if (!tool || tool.removed || tool.definitionHash !== input.definitionHash) throw new OperationError("conflict", "This tool changed or was removed. Refresh and review its current definition.");
    const tools = server.tools.map(tool => tool.name === input.tool ? { ...tool, policy: input.policy, approvedHash: input.definitionHash } : tool);
    const updated = await ctx.db.compareAndSetMcpTools(ctx.organizationId, server.id, server.revision, tools);
    if (!updated) throw new OperationError("conflict", "The server changed. Review the current tool before setting its policy.");
    return updated;
  },
});
export const deleteMcpServerOp = defineOperation({
  name: "mcpServers.delete", capability: "mcpServers:manage", effect: "consequential", input: z.object({ id }), entities,
  run: async (ctx, input) => { await requireServer(ctx, input.id); await ctx.db.table("mcpServerConnections").delete(input.id); },
});
