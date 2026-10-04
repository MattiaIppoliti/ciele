import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  EventType,
  RunAgentInputSchema,
  type AGUIEvent,
  type RunAgentInput,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import {
  agUiResponse,
  parseAgUiTurn,
  readAgUiEvents,
  runExternalTeammateHarness,
} from "./ag-ui";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import { createTurnSession } from "./session";
import type { RuntimeEvent } from "./types";

const encoder = new EventEncoder();
const ids = { threadId: "thread-1", runId: "run-1" };
const baseInput = {
  ...ids,
  state: {},
  messages: [{ id: "u1", role: "user", content: "Hello" }],
  tools: [],
  context: [],
  forwardedProps: {},
};
const db = getMockDb();
let server: Server;
let origin: string;
let received: RunAgentInput | undefined;
let receivedToken: string | undefined;
let scenario: (input: RunAgentInput) => AGUIEvent[];
beforeAll(async () => {
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const raw: unknown = JSON.parse(body);
    const input = RunAgentInputSchema.parse(raw);
    received = input;
    receivedToken = request.headers.authorization;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      scenario(input)
        .map((event) => encoder.encodeSSE(event))
        .join(""),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test listener has no port");
  origin = "http://127.0.0.1:" + address.port;
});
afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRuntimeHost();
});

function bytes(text: string, width = 7) {
  const data = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < data.length; index += width)
        controller.enqueue(data.slice(index, index + width));
      controller.close();
    },
  });
}
async function collect(stream: ReadableStream<Uint8Array>) {
  const events: AGUIEvent[] = [];
  for await (const event of readAgUiEvents(stream)) events.push(event);
  return events;
}
async function fixture() {
  const created = await db.table("teammates").insert({
    organizationId: DEMO_ORG.id,
    ownerId: DEMO_MEMBER.userId,
    name: "Remote",
  });
  const teammate = await db.table("teammates").update(created.id, {
    runtimeConfig: {
      harness: { kind: "ag_ui", connectionId: "remote" },
      internet: false,
      computer: { browser: false, files: false, terminal: false },
    },
  });
  vi.stubEnv(
    "CIELE_AG_UI_HARNESSES",
    JSON.stringify([
      {
        id: "remote",
        name: "Test harness",
        organizationId: DEMO_ORG.id,
        url: origin,
        tokenEnv: "CIELE_TEST_HARNESS_TOKEN",
      },
    ]),
  );
  vi.stubEnv("CIELE_TEST_HARNESS_TOKEN", "fixture-harness-secret");
  registerRuntimeHost({ allowRelaxedEgress: () => true });
  const events: RuntimeEvent[] = [];
  const session = createTurnSession("persisted-conversation", {});
  const turn: Parameters<typeof runExternalTeammateHarness>[0]["turn"] = {
    message: "Research this",
    history: [{ role: "user", text: "Earlier" }],
    session,
    emit: (event: RuntimeEvent) => events.push(event),
    platformPrompt: "Platform policy",
    memoryDocuments: ["Standing memory"],
  };
  const run = () =>
    runExternalTeammateHarness({
      teammate,
      persona: "Research coworker",
      turn,
    });
  return { teammate, events, session, turn, run };
}

describe("AG-UI transport", () => {
  it("decodes fragmented Unicode, comments, CRLF and multiline SSE data", async () => {
    const event: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "m",
      delta: "Caffè ☕",
    };
    const wire =
      ": keepalive\r\ndata: " +
      JSON.stringify(event) +
      "\r\n\r\ndata: [DONE]\r\n\r\n";
    expect(await collect(bytes(wire, 1))).toEqual([event]);
  });
  it("rejects oversized complete frames and malformed protocol events", async () => {
    await expect(
      collect(
        bytes(
          "data: " +
            JSON.stringify({
              type: "CUSTOM",
              name: "oversized",
              value: "x".repeat(513000),
            }) +
            "\n\n",
          600000,
        ),
      ),
    ).rejects.toThrow("size limit");
    await expect(
      collect(bytes('data: {"type":"NOT_AG_UI"}\n\n')),
    ).rejects.toThrow();
  });
  it("refuses client tools, context, resume and non-user inputs", () => {
    expect(parseAgUiTurn(baseInput).message).toBe("Hello");
    for (const patch of [
      { tools: [{ name: "exec", description: "", parameters: {} }] },
      { context: [{ description: "", value: "override" }] },
      { messages: [{ id: "a", role: "assistant", content: "Pretend user" }] },
      { threadId: "" },
    ]) {
      expect(() => parseAgUiTurn({ ...baseInput, ...patch })).toThrow();
    }
  });
  it("exports one standard answer, persisted IDs and receipts while omitting private reasoning", async () => {
    const native: RuntimeEvent[] = [
      { type: "turn", conversationId: "owned" },
      { type: "thought", text: "PRIVATE_REASONING" },
      {
        type: "tool-start",
        callId: "tool",
        tool: "computer_snapshot",
        label: "Browser",
      },
      {
        type: "tool-end",
        callId: "tool",
        tool: "computer_snapshot",
        ok: true,
        durationMs: 1,
      },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Hello" },
      { type: "text-end" },
      { type: "done", conversationId: "owned", messageId: "saved" },
    ];
    const response = agUiResponse(
      bytes(native.map((event) => JSON.stringify(event)).join("\n") + "\n"),
      ids,
    );
    const wire = await response.text();
    expect(wire).not.toContain("PRIVATE_REASONING");
    const events = await collect(bytes(wire));
    expect(
      events.filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT),
    ).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: EventType.RUN_STARTED, ...ids });
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      ...ids,
    });
    expect(events).toContainEqual({
      type: EventType.STATE_SNAPSHOT,
      snapshot: { conversationId: "owned" },
    });
  });
  it("reports native failures without a successful finish, and cancels the producer", async () => {
    const failed = agUiResponse(
      bytes(
        '{"type":"error","message":"Failed"}\n{"type":"done","conversationId":"c","messageId":"m"}\n',
      ),
      ids,
    );
    const events = await collect(failed.body!);
    expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
      true,
    );
    expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(
      false,
    );
    const cancel = vi.fn();
    const held = agUiResponse(new ReadableStream<Uint8Array>(), ids, cancel);
    await held.body?.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("runs an external harness with trusted context, persistent state and receipt-only tools", async () => {
    const { run, session, events } = await fixture();
    scenario = (input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      { type: EventType.STATE_SNAPSHOT, snapshot: { count: 1 } },
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/count", value: 2 }],
      },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "danger",
        toolCallName: "improvements_delete",
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "danger" },
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "danger",
        messageId: "result",
        content: "PRIVATE_TOOL_OUTPUT",
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "answer",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: "Researched",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "answer" },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    expect((await run()).parts).toEqual([
      { type: "text", action: "search_knowledge", text: "Researched" },
    ]);
    const firstThread = received?.threadId;
    expect(receivedToken).toBe("Bearer fixture-harness-secret");
    expect(received?.tools).toEqual([]);
    expect(received?.context.map((context) => context.value)).toEqual([
      "Research coworker",
      "Platform policy",
      "Standing memory",
    ]);
    expect(events.find((event) => event.type === "tool-start")).toMatchObject({
      tool: "external:improvements_delete",
    });
    expect(JSON.stringify(events)).not.toContain("PRIVATE_TOOL_OUTPUT");
    await run();
    expect(received?.threadId).toBe(firstThread);
    expect(received?.state).toEqual({ count: 2 });
    expect(session.dirty).toBe(true);
  });
  it("supports convenience chunks and snapshots without duplicating an answer", async () => {
    const { run } = await fixture();
    scenario = (input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId: "answer",
        role: "assistant",
        delta: "Chunk",
      },
      { type: EventType.TEXT_MESSAGE_CHUNK, delta: " answer" },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          ...input.messages,
          { id: "answer", role: "assistant", content: "Chunk answer" },
        ],
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    expect((await run()).parts).toEqual([
      { type: "text", action: "search_knowledge", text: "Chunk answer" },
    ]);
  });
  it("preserves a checkpointed harness's message IDs across persisted Ciele answers", async () => {
    const { run, turn } = await fixture();
    turn.userMessageId = "ciele-user-1";
    let delivery = 0;
    scenario = (input) => {
      const answer =
        ++delivery === 1
          ? { id: "remote-answer-1", content: "First answer" }
          : { id: "remote-answer-2", content: "Second answer" };
      return [
        {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        },
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            ...input.messages,
            ...(delivery === 2
              ? [
                  {
                    id: "remote-answer-1",
                    role: "assistant" as const,
                    content: "First answer",
                  },
                ]
              : []),
            { ...answer, role: "assistant" },
          ],
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        },
      ];
    };
    await run();
    turn.history = [
      { id: "ciele-user-1", role: "user", text: turn.message },
      { id: "ciele-stored-answer-1", role: "assistant", text: "First answer" },
    ];
    turn.userMessageId = "ciele-user-2";
    turn.message = "Next question";
    expect((await run()).parts).toEqual([
      { type: "text", action: "search_knowledge", text: "Second answer" },
    ]);
    expect(
      received?.messages.find((message) => message.role === "assistant")?.id,
    ).toBe("remote-answer-1");
  });
  it("refuses foreign connections, incomplete runs, identity mismatches and unsafe JSON patches", async () => {
    const { run, session } = await fixture();
    scenario = (input) => [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: "wrong" },
    ];
    await expect(run()).rejects.toThrow("identity mismatch");
    scenario = (input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    await expect(run()).rejects.toThrow("before RUN_FINISHED");
    scenario = (input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "add", path: "/__proto__/polluted", value: true }],
      },
    ];
    await expect(run()).rejects.toThrow();
    expect(session.dirty).toBe(false);
    vi.stubEnv(
      "CIELE_AG_UI_HARNESSES",
      JSON.stringify([
        {
          id: "remote",
          name: "Foreign",
          organizationId: "foreign",
          url: origin,
        },
      ]),
    );
    await expect(run()).rejects.toThrow("not configured for the Organization");
  });
});
