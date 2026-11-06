import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { openSecret, effectiveMcpToolPolicy, type RemoteMcpTool } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { createMcpServerOp, listMcpServersOp, refreshMcpServerOp, setMcpToolPolicyOp } from "./remote-mcp";
import { platformOperationPolicy } from "./platform-actions";
import { publishAssistantOp } from "./publish";
const db = getMockDb();
const tool: Omit<RemoteMcpTool, "approvedHash" | "policy" | "removed"> = { name: "read_orders", description: "Read orders", inputSchema: { type: "object", properties: { id: { type: "string" } } }, definitionHash: "a".repeat(64), readOnlyHint: true };
const remotePort = { discover: async () => [tool], refresh: async () => [tool] };
const context: OperationContext = { db, organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "owner", ports: { remoteMcp: remotePort } };
afterEach(() => { resetMockDb(); vi.unstubAllEnvs(); });
describe("remote MCP configuration", () => {
  it("seals tokens, starts every tool Off and suspends changed or removed definitions", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "synthetic-remote-mcp-key");
    const connection = await createMcpServerOp.run(context, { name: "Orders", url: "https://orders.example/mcp", token: "synthetic-bearer-remote" });
    const sealed = await db.getMcpServerToken(connection.id);
    expect(sealed).not.toContain("synthetic-bearer-remote");
    if (!sealed) throw new Error("Missing sealed token");
    expect(openSecret(sealed)).toBe("synthetic-bearer-remote");
    expect(JSON.stringify(await listMcpServersOp.run(context, {}))).not.toContain("synthetic-bearer-remote");
    expect(effectiveMcpToolPolicy(connection.tools[0])).toBe("off");
    await setMcpToolPolicyOp.run(context, { id: connection.id, tool: tool.name, definitionHash: tool.definitionHash, policy: "run_freely" });
    const changedContext = { ...context, ports: { remoteMcp: { ...remotePort, refresh: async () => [{ ...tool, definitionHash: "b".repeat(64) }] } } };
    const refreshed = await refreshMcpServerOp.run(changedContext, { id: connection.id });
    expect(effectiveMcpToolPolicy(refreshed.tools[0])).toBe("off");
    expect(refreshed.tools[0].approvedHash).toBe(tool.definitionHash);
    await expect(setMcpToolPolicyOp.run(context, { id: connection.id, tool: tool.name, definitionHash: tool.definitionHash, policy: "ask_first" })).rejects.toThrow(/changed/);
    const removed = await refreshMcpServerOp.run({ ...context, ports: { remoteMcp: { ...remotePort, refresh: async () => [] } } }, { id: connection.id });
    expect(removed.tools[0].removed).toBe(true);
  });
  it("refuses Ask first at Publish and records only a reviewed Run freely definition", async () => {
    const connection = await createMcpServerOp.run(context, { name: "Orders", url: "https://orders.example/mcp" });
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "MCP Assistant" });
    await db.updateAssistant(assistant.id, { tools: { remoteMcp: [{ serverId: connection.id, tools: [{ name: tool.name, definitionHash: tool.definitionHash }] }] } });
    await setMcpToolPolicyOp.run(context, { id: connection.id, tool: tool.name, definitionHash: tool.definitionHash, policy: "ask_first" });
    await expect(publishAssistantOp.run(context, { assistantId: assistant.id })).rejects.toThrow(/read_orders.*Run freely/);
    await setMcpToolPolicyOp.run(context, { id: connection.id, tool: tool.name, definitionHash: tool.definitionHash, policy: "run_freely" });
    const publication = await publishAssistantOp.run(context, { assistantId: assistant.id });
    expect((await db.getPublication(publication.publicationId))?.config.assistant.tools.remoteMcp).toEqual([{ serverId: connection.id, tools: [{ name: tool.name, definitionHash: tool.definitionHash }] }]);
  });
  it("keeps policy changes consequential", () => {
    expect(setMcpToolPolicyOp.effect).toBe("consequential");
    expect(platformOperationPolicy(setMcpToolPolicyOp.name)).toBe("confirm");
  });
});
