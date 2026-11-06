"use server";
import { createMcpServerOp, deleteMcpServerOp, listMcpServersOp, refreshMcpServerOp, setMcpToolPolicyOp, OperationError } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
import { CapabilityRefusedError } from "@/lib/authz";
import type { McpToolPolicy } from "@agent-hub/core";
async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (error instanceof OperationError || error instanceof CapabilityRefusedError) return { ok: false, error: error.message };
    return { ok: false, error: "The MCP request failed. Check the server and try again." };
  }
}
export async function listMcpServersAction() { return attempt(() => runOperation(listMcpServersOp, {})); }
export async function createMcpServerAction(input: { name: string; url: string; token?: string }) { return attempt(() => runOperation(createMcpServerOp, input)); }
export async function refreshMcpServerAction(id: string) { return attempt(() => runOperation(refreshMcpServerOp, { id })); }
export async function deleteMcpServerAction(id: string) { return attempt(() => runOperation(deleteMcpServerOp, { id })); }
export async function setMcpToolPolicyAction(input: { id: string; tool: string; definitionHash: string; policy: McpToolPolicy }) { return attempt(() => runOperation(setMcpToolPolicyOp, input)); }
