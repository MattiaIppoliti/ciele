import { describe, expect, it } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway, type ModelMessage } from "ai";
import type { RuntimeEvent } from "../types";
import { runWritePhase } from "./write-phase";

/**
 * The write phase declares no tools, and the gather phase's messages are made
 * of tool calls and tool results. Eval on 28 Sep 2026 showed what that does to
 * Claude: with the right page in the result's Sources, Sonnet 5 through AI
 * Gateway wrote "I haven't retrieved any documentation" on 10 of 24 questions.
 * A toolless Anthropic request has no place for a `tool_use`/`tool_result`
 * block (the API rejects them without `tools`, and a route that keeps the call
 * alive does so by dropping them), so the passages never reach the model.
 *
 * These cases run the REAL provider packages against a fake endpoint, so what
 * is asserted is the wire request, not our own idea of it. The fake reads a
 * toolless request the only way such a request can be read: its text.
 */

const PASSAGE =
  "A conversation must stay quiet for 15 minutes before its memories are promoted to long-term memory.";

/** What the gather phase hands the write phase: one search, then the declaration. */
function gatherMessages(): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Searching for memory promotion timing." },
        {
          type: "tool-call",
          toolCallId: "toolu_search",
          toolName: "searchKnowledge",
          input: { query: "memory promotion quiet period" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "toolu_search",
          toolName: "searchKnowledge",
          output: {
            type: "json",
            value: {
              results: [{ url: "https://docs.ciele.app/data/long-term-memory", text: PASSAGE }],
            },
          },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "toolu_ready",
          toolName: "readyToAnswer",
          input: { status: "answer" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "toolu_ready",
          toolName: "readyToAnswer",
          output: {
            type: "json",
            value: { acknowledged: true, instructions: "Answer from what you found." },
          },
        },
      ],
    },
  ];
}

const QUESTION: ModelMessage = {
  role: "user",
  content: "How long must a conversation stay quiet before its memories are promoted?",
};

/** A model that answers only from what it can read. */
function reply(visibleText: string): string {
  return visibleText.includes("15 minutes")
    ? "15 minutes."
    : "I don't actually have that information available.";
}

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** Anthropic Messages API: text blocks only, unless the request declares tools. */
function anthropicEndpoint(requests: Record<string, unknown>[]) {
  return async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      tools?: unknown[];
      messages: { content: string | { type: string; text?: string }[] }[];
    };
    requests.push(body);
    const hasTools = (body.tools?.length ?? 0) > 0;
    const visible = body.messages
      .flatMap((m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content))
      .filter((b) => b.type === "text" || hasTools)
      .map((b) => b.text ?? JSON.stringify(b))
      .join("\n");
    const text = reply(visible);
    return sse([
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
  };
}

/** AI Gateway: the prompt travels as-is; a toolless call reads as text only. */
function gatewayEndpoint(requests: Record<string, unknown>[]) {
  return async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      tools?: unknown[];
      prompt: { content: string | { type: string; text?: string }[] }[];
    };
    requests.push(body);
    const hasTools = (body.tools?.length ?? 0) > 0;
    const visible = body.prompt
      .flatMap((m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content))
      .filter((p) => p.type === "text" || hasTools)
      .map((p) => p.text ?? JSON.stringify(p))
      .join("\n");
    return sse([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "1" },
      { type: "text-delta", id: "1", delta: reply(visible) },
      { type: "text-end", id: "1" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: {
          inputTokens: { total: 10, noCache: 10 },
          outputTokens: { total: 5, text: 5 },
        },
      },
    ]);
  };
}

async function write(chatModel: Parameters<typeof runWritePhase>[0]["chatModel"]) {
  const events: RuntimeEvent[] = [];
  return runWritePhase({
    chatModel,
    system: "write",
    messages: [QUESTION, ...gatherMessages()],
    streaming: true,
    emit: (e) => events.push(e),
  });
}

/** Every content block or prompt part the request carried, by type. */
function partTypes(messages: { content: string | { type: string }[] }[]): string[] {
  return messages.flatMap((m) => (typeof m.content === "string" ? ["text"] : m.content.map((p) => p.type)));
}

describe("runWritePhase on an Anthropic model", () => {
  it("writes from the gathered passage on the native provider", async () => {
    const requests: Record<string, unknown>[] = [];
    const anthropic = createAnthropic({ apiKey: "test", fetch: anthropicEndpoint(requests) });

    const result = await write(anthropic("claude-sonnet-5"));

    expect(result.text).toBe("15 minutes.");
    const [request] = requests as { tools?: unknown; messages: { content: { type: string }[] }[] }[];
    // A toolless request carries no tool blocks for the API to reject or drop.
    expect(request.tools).toBeUndefined();
    expect(partTypes(request.messages)).not.toContain("tool_use");
    expect(partTypes(request.messages)).not.toContain("tool_result");
  });

  it("writes from the gathered passage through AI Gateway", async () => {
    const requests: Record<string, unknown>[] = [];
    const gateway = createGateway({ apiKey: "test", fetch: gatewayEndpoint(requests) });

    const result = await write(gateway.languageModel("anthropic/claude-sonnet-5"));

    expect(result.text).toBe("15 minutes.");
    const [request] = requests as { prompt: { content: { type: string }[] }[] }[];
    expect(partTypes(request.prompt)).not.toContain("tool-call");
    expect(partTypes(request.prompt)).not.toContain("tool-result");
  });
});
