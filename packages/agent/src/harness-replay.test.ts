import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulateReadableStream, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { buildPublicationConfig } from "@agent-hub/core";
import type { AiUsageInput, Teammate } from "@agent-hub/core";
import * as models from "./models";
import { resetRuntimeHost } from "./host";
import { streamConversationTurn, type ConversationTurnInput } from "./turn";
import { streamChannelChain } from "./channel-turn";
import { bindModelCapacity, contextBudgetMiddleware } from "./context-budget";
import type { RuntimeEvent, TeammateActionTool } from "./types";

type NativeStream = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
type NativePart = NativeStream["stream"] extends ReadableStream<infer Part> ? Part : never;
type Call = { name: string; input: unknown };
type Step = string | Call[] | Error | { partial: string; error: Error };

/** Synthetic provider at model resolution. Everything below it is production:
 * native SDK validation, routing, tools, persistence, spend and telemetry.
 * An unexpected request fails the replay instead of fabricating an answer.
 */
function script(steps: Step[]) {
  let sequence = 0;
  const native = new MockLanguageModelV3({
    doGenerate: async () => { throw new Error("Unexpected generate request"); },
    doStream: async () => {
      const step = steps.shift();
      if (step === undefined) throw new Error("Replay exhausted");
      if (step instanceof Error) throw step;
      sequence += 1;
      const chunks: NativePart[] = [{ type: "stream-start", warnings: [] }];
      if (Array.isArray(step)) {
        for (const [index, call] of step.entries()) chunks.push({ type: "tool-call", toolCallId: `${sequence}:${index}`, toolName: call.name, input: JSON.stringify(call.input) });
      } else {
        chunks.push({ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: typeof step === "string" ? step : step.partial }, { type: "text-end", id: "text" });
        if (typeof step !== "string") chunks.push({ type: "error", error: step.error });
      }
      if (typeof step === "string" || Array.isArray(step)) chunks.push({ type: "finish", finishReason: { unified: Array.isArray(step) ? "tool-calls" : "stop", raw: "stop" }, usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined },
      } });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  const capacity = async () => 400_000;
  const resolved = wrapLanguageModel({ model: native, middleware: contextBudgetMiddleware(capacity) });
  bindModelCapacity(resolved, capacity);
  vi.spyOn(models, "resolveChatModel").mockReturnValue(null);
  vi.spyOn(models, "resolveAssistantChatModel").mockReturnValue({ model: resolved, provider: "openai", modelId: "gpt-5.4-mini", credentialKind: "platform", usedFallback: false });
  vi.spyOn(models, "getClassifierModel").mockReturnValue(null);
  return { native, assertConsumed: () => expect(steps).toHaveLength(0) };
}

const ready: Call[] = [{ name: "readyToAnswer", input: { status: "insufficient_information" } }];
const db = getMockDb();
const signal = () => new AbortController().signal;
const spent = (spy: { mock: { calls: [AiUsageInput[]][] } }): AiUsageInput[] => spy.mock.calls.flatMap(([rows]) => rows);
async function events(input: ConversationTurnInput): Promise<RuntimeEvent[]> {
  return (await new Response(await streamConversationTurn(input)).text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as RuntimeEvent);
}
async function assistantInput(): Promise<Extract<ConversationTurnInput, { assistant: unknown }>> {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Replay" });
  const flow = (await db.listFlows(assistant.id)).find(flow => flow.isDefault)!;
  return { db, assistant, flows: [{ ...flow, actions: ["search_knowledge"] }], connections: [], organizationId: DEMO_ORG.id, subjectType: "visitor", subjectId: "replay-visitor", message: "Explain the library deadline", turnId: crypto.randomUUID(), signal: signal() };
}
async function teammate(name = "Sam"): Promise<Teammate> {
  return db.table("teammates").insert({ organizationId: DEMO_ORG.id, ownerId: DEMO_MEMBER.userId, name });
}

beforeEach(() => { resetMockDb(); resetRuntimeHost(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("production harness replays", () => {
  it("settles a completed gather when the next provider request fails and audits metadata only", async () => {
    const replay = script([ready, { partial: "PRIVATE FAILED DRAFT", error: new Error("PRIVATE PROVIDER DETAIL") }]);
    const usage = vi.spyOn(db, "recordAiUsage");
    const audit = vi.spyOn(db, "recordRuntimeEvent");
    const wire = await events(await assistantInput());
    expect(wire.some(event => event.type === "done")).toBe(false);
    expect(wire.at(-1)).toMatchObject({ type: "error" });
    expect(spent(usage)).toMatchObject([{ inputTokens: 10, outputTokens: 2 }]);
    const failed = audit.mock.calls.map(call => call[0]).find(row => row.status === "failed");
    expect(failed).toMatchObject({ inputTokens: 10, outputTokens: 2, errorClass: "Error" });
    expect(JSON.stringify(failed)).not.toContain("PRIVATE");
    replay.assertConsumed();
  });

  it("keeps a completed mutation and its usage when the Teammate write phase fails", async () => {
    const sam = await teammate();
    const replay = script([[{ name: "improvements_create", input: { title: "Replay mutation" } }, ...ready], new Error("write failed")]);
    const usage = vi.spyOn(db, "recordAiUsage");
    const run = vi.fn(async (input: Record<string, unknown>) => {
      const created = await db.createImprovement(DEMO_ORG.id, { title: String(input.title) });
      return { result: { id: created.id }, entities: [] };
    });
    const actions: TeammateActionTool[] = [{ operation: "improvements.create", domain: "improvements", label: "Create improvement", description: "Create an improvement", inputSchema: z.object({ title: z.string() }), run }];
    const wire = await events({ db, teammate: sam, connections: [], organizationId: DEMO_ORG.id, subjectType: "member", subjectId: DEMO_MEMBER.userId, message: "Create an improvement", teammateActions: actions, turnId: crypto.randomUUID(), signal: signal() });
    expect(run).toHaveBeenCalledOnce();
    expect((await db.listImprovements(DEMO_ORG.id)).some(row => row.title === "Replay mutation")).toBe(true);
    expect(wire.some(event => event.type === "done")).toBe(false);
    expect(spent(usage)).toMatchObject([{ spenders: { teammateId: sam.id }, inputTokens: 10 }]);
    replay.assertConsumed();
  });

  it("replays a committed reply without further model requests or spend", async () => {
    const replay = script([ready, "No deadline was found in the available material."]);
    const usage = vi.spyOn(db, "recordAiUsage");
    const input = await assistantInput();
    const first = await events(input);
    const second = await events(input);
    expect(first.at(-1)).toMatchObject({ type: "done" });
    expect(second.at(-1)).toEqual(first.at(-1));
    expect(replay.native.doStreamCalls).toHaveLength(2);
    expect(spent(usage)).toHaveLength(2);
    replay.assertConsumed();
  });

  it("settles all completed calls if reply persistence fails and never emits done", async () => {
    const replay = script([ready, "Finished draft"]);
    const usage = vi.spyOn(db, "recordAiUsage");
    vi.spyOn(db, "commitConversationTurn").mockRejectedValue(new Error("commit unavailable"));
    const wire = await events(await assistantInput());
    expect(wire.some(event => event.type === "done")).toBe(false);
    expect(spent(usage)).toHaveLength(2);
    replay.assertConsumed();
  });

  it("survives telemetry failure after a durable reply", async () => {
    const replay = script([ready, "Finished reply"]);
    vi.spyOn(db, "recordRuntimeEvent").mockRejectedValue(new Error("telemetry unavailable"));
    expect((await events(await assistantInput())).at(-1)).toMatchObject({ type: "done" });
    replay.assertConsumed();
  });

  it("allows native schema correction without running rejected arguments", async () => {
    const replay = script([[{ name: "readyToAnswer", input: { status: "malformed" } }], ready, "Corrected reply"]);
    const wire = await events(await assistantInput());
    expect(wire.at(-1)).toMatchObject({ type: "done" });
    const starts = wire.filter(event => event.type === "tool-start" && event.tool === "readyToAnswer");
    expect(starts).toHaveLength(1);
    expect(JSON.stringify(replay.native.doStreamCalls[1]?.prompt)).toContain("error");
    replay.assertConsumed();
  });

  it("meters completed target calls when a failed handover keeps the origin acknowledgement", async () => {
    const input = await assistantInput();
    const target = await db.createAssistant(DEMO_ORG.id, { title: "Specialist" });
    await db.createPublication(target.id, buildPublicationConfig(target, await db.listFlows(target.id), []));
    const flow = await db.createFlow(input.assistant.id, { name: "Specialist", actions: ["handover"], actionSettings: { handover: { assistantId: target.id } } });
    const replay = script([ready, new Error("Target write failed")]);
    const usage = vi.spyOn(db, "recordAiUsage");
    const result = await events({ ...input, flows: [flow], message: "Specialist" });
    expect(result.at(-1)?.type).toBe("done");
    expect(spent(usage)).toHaveLength(1);
    replay.assertConsumed();
  });

  it("persists a Channel approval card against the real Channel before a mutation runs", async () => {
    const sam = await teammate();
    const channel = await db.table("teammateChannels").insert({ organizationId: DEMO_ORG.id, name: "Approval replay", createdBy: DEMO_MEMBER.userId });
    const startMessage = await db.appendChannelMessage({ organizationId: DEMO_ORG.id, channelId: channel.id, authorType: "member", authorUserId: DEMO_MEMBER.userId, content: [{ type: "text", text: "@Sam delete the assistant" }], mentions: [sam.id] });
    const run = vi.fn(async () => ({ result: { done: true }, entities: [] }));
    const action: TeammateActionTool = { domain: "platform", operation: "platform.run", label: "Delete assistant", description: "Delete assistant", inputSchema: z.object({ id: z.string() }), alwaysConfirm: () => true, run };
    const replay = script([[{ name: "platform_run", input: { id: "assistant-target" } }], ready, "The action waits for approval."]);
    const wire = await new Response(await streamChannelChain({ db, organizationId: DEMO_ORG.id, channel, roster: [{ id: sam.id, name: sam.name, kind: "teammate" }], teammates: [sam], connections: [], startMessage, startedBy: { userId: DEMO_MEMBER.userId }, targets: [sam.id], teammateActions: async () => [action], signal: signal() })).text();
    const approvals = await db.table("actionApprovals").list({ channelId: channel.id });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ conversationId: null, channelId: channel.id, requestedBy: DEMO_MEMBER.userId, status: "pending", input: { id: "assistant-target" } });
    expect(wire).toContain("action_approval");
    expect(run).not.toHaveBeenCalled();
    replay.assertConsumed();
  });

  it("settles a failed Channel speaker, counts its marker, and lets the next speaker answer", async () => {
    const sam = await teammate("Sam");
    const nora = await teammate("Nora");
    const channel = await db.table("teammateChannels").insert({ organizationId: DEMO_ORG.id, name: "Replay channel", createdBy: DEMO_MEMBER.userId });
    const startMessage = await db.appendChannelMessage({ organizationId: DEMO_ORG.id, channelId: channel.id, authorType: "member", authorUserId: DEMO_MEMBER.userId, content: [{ type: "text", text: "@Sam @Nora explain deadlines" }], mentions: [sam.id, nora.id] });
    const replay = script([ready, new Error("Sam write failed"), ready, "Nora's answer"]);
    const usage = vi.spyOn(db, "recordAiUsage");
    const wire = await new Response(await streamChannelChain({ db, organizationId: DEMO_ORG.id, channel, roster: [{ id: sam.id, name: sam.name, kind: "teammate" }, { id: nora.id, name: nora.name, kind: "teammate" }, { id: DEMO_MEMBER.userId, name: "Member", kind: "member" }], teammates: [sam, nora], connections: [], startMessage, startedBy: { userId: DEMO_MEMBER.userId }, targets: [sam.id, nora.id], signal: signal() })).text();
    const messages = await db.listChannelMessages(channel.id);
    expect(messages.filter(message => message.authorTeammateId === sam.id)).toHaveLength(1);
    expect(messages.filter(message => message.authorTeammateId === nora.id)).toHaveLength(1);
    expect(wire).toContain("Nora's answer");
    expect(spent(usage).filter(row => row.spenders?.teammateId === sam.id)).toHaveLength(1);
    expect(spent(usage).filter(row => row.spenders?.teammateId === nora.id)).toHaveLength(2);
    replay.assertConsumed();
  });
});
