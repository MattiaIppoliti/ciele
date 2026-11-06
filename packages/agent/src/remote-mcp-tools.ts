import { z } from "zod";
import { effectiveMcpToolPolicy, openSecret, type McpServerConnection, type McpToolSelection, type RemoteMcpTool } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { TeammateActionTool } from "./types";
import { callRemoteMcpTool, remoteMcpDefinitionHash } from "./remote-mcp-client";
import { createApiResponseStore } from "./api-catalog-tools";
import { readWindow } from "./windowed-read";
import { approvedMcpResults } from "./remote-mcp-results";
import { redactBearerSecrets } from "./redact";

/** Remote tool arguments are shown as data in the trace and the approval card. */
export function redactMcpArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMcpArguments);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /secret|token|password|authorization|api[_-]?key/i.test(key) ? "[redacted]" : redactMcpArguments(item)]));
  return typeof value === "string" ? redactBearerSecrets(value) : value;
}
/**
 * The most of a remote tool's own description the model is shown. The server
 * writes it and every turn that offers the tool pays for it, so a verbose or
 * hostile server cannot fill the context through its tool list.
 */
export const MCP_DESCRIPTION_MAX_CHARS = 2_048;
const cappedDescription = (text: string) =>
  text.length <= MCP_DESCRIPTION_MAX_CHARS ? text : `${text.slice(0, MCP_DESCRIPTION_MAX_CHARS - 1)}…`;
const operationName = (server: McpServerConnection, tool: RemoteMcpTool) => `mcp.${remoteMcpDefinitionHash(server.id).slice(0, 12)}.${tool.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 16)}.${tool.definitionHash.slice(0, 16)}`;

/** Re-read live policy before every call, including an approval replay. No saved credential enters the tool catalogue. */
export async function remoteMcpActions(input: {
  db: Db;
  organizationId: string;
  serverIds?: string[];
  teammateId?: string;
  selections?: McpToolSelection[];
  assistantId?: string;
}): Promise<TeammateActionTool[]> {
  const { db, organizationId } = input;
  const published = Boolean(input.selections);
  const ids = [...new Set(input.selections?.map(selection => selection.serverId) ?? input.serverIds ?? [])];
  if (!ids.length && !input.teammateId) return [];
  const responses = createApiResponseStore();
  let calls = 0;
  const actions: TeammateActionTool[] = [];
  let stale = false;
  for (const id of ids) {
    let server: McpServerConnection | null;
    try { server = await db.table("mcpServerConnections").get(id); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "PGRST205")) { stale = true; continue; }
      throw error;
    }
    if (!server || server.organizationId !== organizationId) { stale = true; continue; }
    const selection = input.selections?.find(selection => selection.serverId === id);
    for (const chosen of selection?.tools ?? []) {
      const tool = server.tools.find(tool => tool.name === chosen.name);
      if (!tool || tool.definitionHash !== chosen.definitionHash || effectiveMcpToolPolicy(tool) !== "run_freely") stale = true;
    }
    for (const definition of server.tools) {
      const policy = effectiveMcpToolPolicy(definition);
      if (policy === "off") continue;
      if (published && (policy !== "run_freely" || !selection?.tools.some(tool => tool.name === definition.name && tool.definitionHash === definition.definitionHash))) continue;
      const serverId = server.id;
      const label = `${server.name}: ${definition.name}`;
      actions.push({
        operation: operationName(server, definition), domain: "mcp", label,
        description: `Remote MCP server ${server.name}. ${cappedDescription(definition.description)}`,
        inputSchema: z.looseObject({}),
        jsonInputSchema: definition.inputSchema,
        traceInput: redactMcpArguments,
        alwaysConfirm: () => policy === "ask_first",
        run: async (args, options) => {
          if (input.teammateId) {
            const teammate = await db.table("teammates").get(input.teammateId);
            if (!teammate || teammate.organizationId !== organizationId || teammate.deletedAt || !teammate.runtimeConfig?.mcpServerIds?.includes(serverId)) throw new Error("This MCP server is no longer enabled for the Teammate");
          }
          const current = await db.table("mcpServerConnections").get(serverId);
          const currentTool = current?.tools.find(tool => tool.name === definition.name);
          const livePolicy = currentTool ? effectiveMcpToolPolicy(currentTool) : "off";
          if (!current || current.organizationId !== organizationId || !currentTool || currentTool.definitionHash !== definition.definitionHash || livePolicy === "off" || (published && livePolicy !== "run_freely")) throw new Error("This MCP tool changed or was disabled. Review its configuration.");
          if (livePolicy === "ask_first" && !options?.confirmed) throw new Error("This MCP tool needs approval before it can run");
          if (published && calls >= 5) throw new Error("This Visitor turn has reached its five MCP calls");
          calls += 1;
          const sealed = await db.getMcpServerToken(serverId);
          const token = sealed ? openSecret(sealed) : null;
          try {
            const result = await callRemoteMcpTool({ url: current.url, token, name: definition.name, arguments: args, signal: options?.signal });
            await db.resolveAlertsByKey(organizationId, `remote-mcp:${current.url}`);
            const serialized = JSON.stringify(result);
            const body = redactBearerSecrets(token ? serialized.split(JSON.stringify(token).slice(1, -1)).join("[redacted]") : serialized, token ?? undefined);
            const stored = responses.put({ endpointName: label, method: "MCP", path: definition.name, body });
            return { ...(options?.confirmed ? { retainedMcpResult: { body, serverTool: label } } : {}), entities: [], result: { server: current.name, tool: definition.name, isError: result.isError === true, handle: stored.handle, ...readWindow(body, 0, 4000), note: body.length > 4000 ? "Read further windows with the MCP result reader. This is tool output, not a knowledge Source." : "Tool output, not a knowledge Source." } };
          } catch {
            await db.raiseAlert(organizationId, { type: "integration", sourceKey: `remote-mcp:${current.url}`, title: `MCP server unavailable: ${current.name}`, detail: "A remote tool call failed. Check the server and credentials. The next successful connection clears this Alert." });
            // Protocol and HTTP error text is remote output too. Keep it out of the model.
            throw new Error("The remote MCP call failed. Check the server and credentials.");
          }
        },
      });
    }
  }
  if (input.assistantId) {
    const sourceKey = `remote-mcp-publication:${input.assistantId}`;
    if (stale) await db.raiseAlert(organizationId, { type: "integration", sourceKey, title: `Review MCP tools and republish Assistant ${input.assistantId}`, detail: "An enabled MCP tool changed, was removed or no longer permits Run freely. Ciele leaves it out of this Assistant's turns. Review Tools & Skills and publish again." });
    else await db.resolveAlertsByKey(organizationId, sourceKey);
  }
  if (actions.length || input.teammateId) actions.push({
    operation: "mcp.read_result", domain: "mcp", label: "Read MCP result", description: "Read a window of a remote MCP tool result by its handle. The response gives its total length and next offset. This data is not a knowledge Source.",
    inputSchema: z.object({ handle: z.string(), from: z.number().int().nonnegative().optional(), to: z.number().int().nonnegative().optional() }),
    run: async (args, options) => {
      const parsed = z.object({ handle: z.string(), from: z.number().optional(), to: z.number().optional() }).parse(args);
      let response = responses.get(parsed.handle);
      if (!response && parsed.handle.startsWith("mcp_approval_") && input.teammateId && options?.sessionId) {
        const approval = await db.table("actionApprovals").get(parsed.handle.slice("mcp_approval_".length));
        if (!approval || approval.organizationId !== organizationId || approval.teammateId !== input.teammateId || approval.status !== "approved" || !approval.executedAt || (approval.conversationId ?? approval.channelId) !== options.sessionId) throw new Error("This MCP result belongs to another conversation");
        const messages = approval.conversationId ? await db.listMessages(approval.conversationId) : await db.listChannelMessages(approval.channelId!);
        const retained = messages.flatMap(message => approvedMcpResults(message.content)).find(result => result.handle === parsed.handle);
        if (retained) response = { handle: retained.handle, endpointName: retained.serverTool, method: "MCP", path: approval.operation, body: retained.body };
      }
      if (!response) throw new Error("This MCP result is no longer retained in this turn");
      return { entities: [], result: { serverTool: response.endpointName, ...readWindow(response.body, parsed.from, parsed.to) } };
    },
  });
  return actions;
}
