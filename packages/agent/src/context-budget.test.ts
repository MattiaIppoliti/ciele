import { describe, expect, it } from "vitest";
import { generateText, wrapLanguageModel, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { bindModelCapacity, contextBudgetMiddleware, conversationContext, requestUpperBound } from "./context-budget";

const model = () => new MockLanguageModelV3({ doGenerate: async () => ({
  content: [{ type: "text", text: "Older fact: the deadline is Friday." }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 8, text: 8, reasoning: undefined } },
  warnings: [],
}) });

describe("whole-request context budgets", () => {
  it("counts UTF-8 bytes and provider framing conservatively", () => {
    expect(requestUpperBound("😀".repeat(100), 2)).toBeGreaterThan(requestUpperBound("a".repeat(100), 2));
  });
  it("refuses unknown capacity and immutable overflow before provider egress", async () => {
    for (const capacity of [null, 8192]) {
      const native = model();
      const wrapped = wrapLanguageModel({ model: native, middleware: contextBudgetMiddleware(async () => capacity) });
      await expect(generateText({ model: wrapped, system: "Skill " + "x".repeat(10000), prompt: "Question" })).rejects.toThrow(/capacity|context window/);
      expect(native.doGenerateCalls).toHaveLength(0);
    }
  });
  it("includes native tool schemas and reserved output in admission", async () => {
    const native = model();
    const wrapped = wrapLanguageModel({ model: native, middleware: contextBudgetMiddleware(async () => 8192) });
    await expect(generateText({ model: wrapped, prompt: "Question", tools: { huge: tool({ description: "x".repeat(9000), inputSchema: z.object({ name: z.string() }) }) } })).rejects.toThrow("context window");
    expect(native.doGenerateCalls).toHaveLength(0);
  });
  it("prunes complete old exchanges while retaining the current request and evidence pair", async () => {
    const native = model();
    bindModelCapacity(native, async () => 14000);
    const project = conversationContext({ model: native, history: [
      { role: "user", content: "old " + "x".repeat(9000) }, { role: "assistant", content: "old answer" },
      { role: "user", content: "recent" }, { role: "assistant", content: "recent answer" },
    ], current: { role: "user", content: "current" }, summaryFence: text => `<untrusted>${text}</untrusted>` });
    const pair = [
      { role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: "read", toolName: "read", input: {} }] },
      { role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: "read", toolName: "read", output: { type: "text" as const, value: "<untrusted>Source evidence</untrusted>" } }] },
    ];
    const messages = await project("Whole Skill and Memory Document", pair);
    expect(messages.slice(-2)).toEqual(pair);
    expect(messages[0]?.content).toBe("recent");
    expect(JSON.stringify(messages)).not.toContain("old answer");
    expect(native.doGenerateCalls).toHaveLength(0);
  });
  it("makes at most one capped metered summary across gather and write", async () => {
    const native = model();
    bindModelCapacity(native, async () => 32768);
    const usage: unknown[] = [];
    const project = conversationContext({ model: native, history: [
      { role: "user", content: "older conversation " + "x".repeat(35000) }, { role: "assistant", content: "previous answer" },
    ], current: { role: "user", content: "Current question" }, summaryFence: text => `<untrusted>${text}</untrusted>`, recordUsage: row => usage.push(row) });
    const first = await project("Entire authored Skill", []);
    const second = await project("Entire authored Skill", [{ role: "user", content: "Source evidence remains intact" }]);
    expect(native.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(native.doGenerateCalls[0]?.prompt).length).toBeLessThan(18000);
    expect(usage).toEqual([{ inputTokens: 100, outputTokens: 8 }]);
    expect(JSON.stringify(first)).toContain("Older fact");
    expect(JSON.stringify(second)).toContain("Source evidence remains intact");
  });
});
