import type { Db } from "@agent-hub/db";
import { EMPTY_TURN_TRACE } from "./stream";
import { prepareTraceForStorage } from "./trace";
import { redactMcpArguments } from "./remote-mcp-tools";

/** Persist a safe decision for the next model turn and a bounded call trace for the Inbox. */
export async function recordRemoteMcpApprovalOutcome(db: Db, approvalId: string, outcome?: unknown): Promise<void> {
  const approval = await db.table("actionApprovals").get(approvalId);
  if (!approval || !approval.operation.startsWith("mcp.") || (approval.status !== "approved" && approval.status !== "rejected")) return;
  const teammate = approval.teammateId ? await db.table("teammates").get(approval.teammateId) : null;
  if (!teammate || teammate.organizationId !== approval.organizationId) throw new Error("Approval Teammate mismatch");
  const rejected = approval.status === "rejected";
  const result = outcome && typeof outcome === "object" && "result" in outcome ? outcome.result : null;
  const failed = result && typeof result === "object" && "isError" in result && result.isError === true;
  const candidate = !rejected && outcome && typeof outcome === "object" && "retainedMcpResult" in outcome ? outcome.retainedMcpResult : null;
  const retained = candidate && typeof candidate === "object" && "body" in candidate && typeof candidate.body === "string" && candidate.body.length <= 1_048_576 && "serverTool" in candidate && typeof candidate.serverTool === "string" ? candidate : null;
  const resultPart = retained ? { type: "mcp_result", handle: `mcp_approval_${approval.id}`, serverTool: retained.serverTool, body: retained.body } : null;
  const content: unknown[] = [];
  const text = rejected ? `Remote MCP approval ${approval.id} was refused. No call was sent.` : failed ? `Remote MCP approval ${approval.id} failed to return a result. Check the remote system before retrying.` : `Remote MCP approval ${approval.id} completed. The approved result is available to the next turn.`;
  content.push({ type: "text", action: "custom_message", text });
  if (resultPart) content.push(resultPart);
  const trace = prepareTraceForStorage({
    ...EMPTY_TURN_TRACE, phase: "done",
    steps: [{ id: approval.id, kind: "tool", tool: approval.operation, label: approval.label, status: rejected || failed ? "error" : "done", input: { arguments: redactMcpArguments(approval.input) }, detail: rejected ? "The Member refused the call" : failed ? "The approved call failed to return a result" : "The Member approved the call", result: result ? { output: result } : undefined }],
  });
  if (approval.conversationId) {
    const conversation = await db.getConversation(approval.conversationId);
    if (!conversation || conversation.teammateId !== approval.teammateId) throw new Error("Approval Conversation mismatch");
    await db.appendMessage({ conversationId: conversation.id, role: "assistant", content, trace });
  } else if (approval.channelId) {
    const channel = await db.table("teammateChannels").get(approval.channelId);
    if (channel?.organizationId !== approval.organizationId) throw new Error("Approval Channel mismatch");
    await db.appendChannelMessage({ organizationId: approval.organizationId, channelId: approval.channelId, authorType: "teammate", authorTeammateId: approval.teammateId, content, trace });
  }
}
