import { createHash, randomUUID } from "node:crypto";
import {
  EventSchemas,
  EventType,
  RunAgentInputSchema,
  type AGUIEvent,
  type RunAgentInput,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { applyPatch } from "fast-json-patch";
import { z } from "zod";
import { teammateRuntimeConfig, type Teammate } from "@agent-hub/core";
import { validateEgressTarget } from "./egress";
import { getRuntimeHost } from "./host";
import { pinnedStreamingRequest } from "./pinned-fetch";
import { registeredHarnesses } from "./teammate-execution-config";
import { decodeRuntimeEvents } from "./stream";
import type { TeammateAnswerTurn } from "./teammate-answer";
import type { ChatReplyPart, RunResult } from "./types";

const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string() }),
  z.object({ op: z.literal("copy"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("move"), path: z.string(), from: z.string() }),
]);
const replyIdentitySchema = z.object({
  userMessageId: z.string(),
  textHash: z.string(),
  messages: z
    .array(
      z.object({
        id: z.string().max(512),
        length: z.number().int().nonnegative(),
      }),
    )
    .max(100),
});
const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export function agUiThreadKey(...identities: string[]) {
  return `agui_${createHash("sha256").update(JSON.stringify(identities)).digest("hex")}`;
}

/** Input history, state and frontend tools are never authority over Ciele's persisted turn. */
export function parseAgUiTurn(raw: unknown): {
  input: RunAgentInput;
  message: string;
} {
  const input = RunAgentInputSchema.parse(raw);
  if (
    !input.threadId ||
    input.threadId.length > 512 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(input.runId)
  )
    throw new Error("Invalid AG-UI thread or run ID");
  if (input.messages.length > 100 || JSON.stringify(input).length > 1024000)
    throw new Error("AG-UI input exceeded the size limit");
  const latest = input.messages.at(-1);
  if (
    !latest ||
    latest.role !== "user" ||
    typeof latest.content !== "string" ||
    !latest.content.trim() ||
    latest.content.length > 32000
  ) {
    throw new Error("An AG-UI run must end with a non-empty text user message");
  }
  if (input.tools.length || input.context.length || input.resume?.length)
    throw new Error(
      "Ciele's AG-UI endpoint accepts persisted server tools and context only",
    );
  return { input, message: latest.content.trim() };
}

/** Native Ciele NDJSON → the standard AG-UI event stream. Rich Ciele parts remain custom events. */
export function agUiResponse(
  body: ReadableStream<Uint8Array>,
  input: Pick<RunAgentInput, "threadId" | "runId">,
  onCancel?: () => void,
): Response {
  const encoder = new EventEncoder();
  const textEncoder = new TextEncoder();
  const cancellation = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AGUIEvent) => {
        if (!cancelled)
          controller.enqueue(textEncoder.encode(encoder.encodeSSE(event)));
      };
      let messageId: string | null = null;
      let ordinal = 0;
      let failed = false;
      let finished = false;
      const closeText = () => {
        if (messageId) send({ type: EventType.TEXT_MESSAGE_END, messageId });
        messageId = null;
      };
      const startText = () => {
        closeText();
        messageId = `${input.runId}_message_${++ordinal}`;
        send({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
      };
      send({ type: EventType.RUN_STARTED, ...input });
      try {
        for await (const event of decodeRuntimeEvents(
          body,
          cancellation.signal,
        )) {
          switch (event.type) {
            case "text-start":
              startText();
              break;
            case "text-delta":
              if (!messageId) startText();
              if (messageId && event.delta)
                send({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId,
                  delta: event.delta,
                });
              break;
            case "text-end":
              closeText();
              break;
            case "tool-start":
              send({
                type: EventType.TOOL_CALL_START,
                toolCallId: event.callId,
                toolCallName: event.tool,
              });
              send({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: event.callId,
                delta: JSON.stringify(event.input ?? {}),
              });
              send({ type: EventType.TOOL_CALL_END, toolCallId: event.callId });
              break;
            case "tool-end":
              send({
                type: EventType.TOOL_CALL_RESULT,
                toolCallId: event.callId,
                messageId: `${input.runId}_result_${event.callId}`,
                content: JSON.stringify({
                  ok: event.ok,
                  summary: event.summary,
                  result: event.result,
                }),
                role: "tool",
              });
              break;
            case "part":
              if (event.part.type === "text") {
                startText();
                if (messageId && event.part.text)
                  send({
                    type: EventType.TEXT_MESSAGE_CONTENT,
                    messageId,
                    delta: event.part.text,
                  });
                closeText();
              } else
                send({
                  type: EventType.CUSTOM,
                  name: "ciele.part",
                  value: event.part,
                });
              break;
            case "error":
              closeText();
              failed = true;
              send({
                type: EventType.RUN_ERROR,
                message: event.message,
                code: event.code,
              });
              break;
            case "done":
              finished = true;
              break;
            // Do not export private model reasoning. Notices and persisted IDs are UI state.
            case "turn":
              send({
                type: EventType.STATE_SNAPSHOT,
                snapshot: { conversationId: event.conversationId },
              });
              send({
                type: EventType.CUSTOM,
                name: "ciele.turn",
                value: event,
              });
              break;
            case "flow":
            case "notice":
              send({
                type: EventType.CUSTOM,
                name: `ciele.${event.type}`,
                value: event,
              });
              break;
          }
        }
        closeText();
        if (!failed) {
          if (!finished)
            send({
              type: EventType.RUN_ERROR,
              message: "Ciele turn ended before completion",
            });
          else send({ type: EventType.RUN_FINISHED, ...input });
        }
      } catch {
        if (!cancelled)
          send({
            type: EventType.RUN_ERROR,
            message: "Ciele turn stream failed",
          });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      cancellation.abort();
      onCancel?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": encoder.getContentType(),
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** SSE decoding with frame and response budgets; supports fragmented UTF-8 and CRLF frames. */
export async function* readAgUiEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AGUIEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  function parse(frame: string) {
    if (frame.length > 512000)
      throw new Error("AG-UI event exceeded the size limit");
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return !data || data === "[DONE]"
      ? null
      : EventSchemas.parse(JSON.parse(data));
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 5 * 1024 * 1024)
        throw new Error("AG-UI response exceeded the size limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = parse(frame);
        if (event) yield event;
      }
      if (buffer.length > 512000)
        throw new Error("AG-UI event exceeded the size limit");
    }
    if (buffer.trim()) {
      const event = parse(buffer);
      if (event) yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** The external harness owns tools and billing. Ciele keeps tenancy, history and receipts. */
export async function runExternalTeammateHarness(options: {
  teammate: Teammate;
  turn: TeammateAnswerTurn;
  persona: string;
}): Promise<RunResult> {
  const runtime = teammateRuntimeConfig(options.teammate);
  if (runtime.harness.kind !== "ag_ui")
    throw new Error("An external harness was not selected");
  const id = runtime.harness.connectionId;
  const connection = registeredHarnesses(options.teammate.organizationId).find(
    (entry) => entry.id === id,
  );
  if (!connection)
    throw new Error(
      "This AG-UI harness is not configured for the Organization",
    );
  if (options.turn.hasAttachments)
    throw new Error(
      "External harnesses currently accept text only; use the Ciele harness for attachments",
    );
  const session = options.turn.session;
  const threadId = agUiThreadKey(
    options.teammate.organizationId,
    options.teammate.id,
    session?.conversationId ?? randomUUID(),
    id,
  );
  const runId = randomUUID();
  const stateKey = `agui:${options.teammate.id}:${id}`;
  const identityKey = `${stateKey}:message-identities`;
  const identities = z
    .array(replyIdentitySchema)
    .max(40)
    .parse(session?.get(identityKey) ?? []);
  const history = (options.turn.history ?? []).slice(-40);
  let state: unknown = session?.get(stateKey) ?? {};
  const input: RunAgentInput = {
    threadId,
    runId,
    state,
    messages: [
      ...history.flatMap((message, index) => {
        const previous = history[index - 1];
        const identity =
          previous?.role === "user" &&
          identities.find((entry) => entry.userMessageId === previous.id);
        // Ciele stores one answer containing all text parts; a checkpointed harness
        // keeps its original assistant IDs. Restore them only for the same persisted text.
        if (
          message.role === "assistant" &&
          identity &&
          identity.textHash === textHash(message.text)
        ) {
          let offset = 0;
          return identity.messages.map(({ id, length }) => {
            const content = message.text.slice(offset, offset + length);
            offset += length + 1; // messageText joins text parts with a newline.
            return { id, role: message.role, content };
          });
        }
        return [
          {
            id: message.id ?? `${threadId}_${index}`,
            role: message.role,
            content: message.text,
          },
        ];
      }),
      {
        id: options.turn.userMessageId ?? `${runId}_user`,
        role: "user",
        content: options.turn.message,
      },
    ],
    tools: [],
    context: [
      { description: "Ciele Teammate standing role", value: options.persona },
      ...(options.turn.platformPrompt
        ? [
            {
              description: "Ciele platform instructions",
              value: options.turn.platformPrompt,
            },
          ]
        : []),
      ...(options.turn.memoryDocuments ?? []).map((value) => ({
        description: "Ciele standing memory",
        value,
      })),
    ],
    forwardedProps: {},
  };
  const target = await validateEgressTarget(connection.url, {
    allowHttp: getRuntimeHost().allowRelaxedEgress(),
    allowLoopback: getRuntimeHost().allowRelaxedEgress(),
  });
  const token = connection.tokenEnv
    ? process.env[connection.tokenEnv]
    : undefined;
  if (connection.tokenEnv && !token)
    throw new Error("The external harness credential is not configured");
  const signal = AbortSignal.any([
    ...(options.turn.signal ? [options.turn.signal] : []),
    AbortSignal.timeout(240000),
  ]);
  const response = await pinnedStreamingRequest(target, {
    method: "POST",
    timeoutMs: 90000,
    signal,
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await response.body?.cancel();
    throw new Error(
      `External harness did not return AG-UI SSE (HTTP ${response.status})`,
    );
  }
  const emit = options.turn.emit ?? (() => {});
  const texts = new Map<string, string>();
  const calls = new Map<string, { name: string; startedAt: number }>();
  const parts: ChatReplyPart[] = [];
  const completedTexts = new Map<string, string>();
  const inputMessageIds = new Set(input.messages.map((message) => message.id));
  let chunkMessageId: string | null = null;
  let chunkCallId: string | null = null;
  const beginText = (id: string, role?: string) => {
    if (
      (role && role !== "assistant") ||
      texts.size ||
      texts.has(id) ||
      completedTexts.has(id)
    )
      throw new Error("Invalid external assistant message");
    texts.set(id, "");
    emit({ type: "text-start", action: "search_knowledge" });
  };
  const endText = (id: string) => {
    const text = texts.get(id);
    if (text === undefined) throw new Error("Text end has no message start");
    if (text) parts.push({ type: "text", action: "search_knowledge", text });
    completedTexts.set(id, text);
    texts.delete(id);
    if (chunkMessageId === id) chunkMessageId = null;
    emit({ type: "text-end" });
  };
  const beginCall = (id: string, name: string) => {
    if (calls.has(id)) throw new Error("Duplicate external tool call");
    calls.set(id, { name, startedAt: Date.now() });
    emit({
      type: "tool-start",
      callId: id,
      tool: `external:${name}`,
      label: `External harness: ${name}`,
    });
  };
  let started = false;
  let finished = false;
  emit({ type: "notice", label: `Connected to ${connection.name}` });
  for await (const event of readAgUiEvents(response.body)) {
    signal.throwIfAborted();
    if (event.type === EventType.RUN_STARTED) {
      if (started || event.threadId !== threadId || event.runId !== runId)
        throw new Error("External harness run identity mismatch");
      started = true;
      continue;
    }
    if (!started || finished)
      throw new Error("External harness sent events outside its run");
    // AG-UI's convenience chunks imply a text end at the next different event.
    if (
      chunkMessageId &&
      (event.type !== EventType.TEXT_MESSAGE_CHUNK ||
        (event.messageId && event.messageId !== chunkMessageId))
    )
      endText(chunkMessageId);
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
        beginText(event.messageId, event.role);
        break;
      case EventType.TEXT_MESSAGE_CONTENT: {
        const previous = texts.get(event.messageId);
        if (previous === undefined)
          throw new Error("Text content has no message start");
        texts.set(event.messageId, previous + event.delta);
        emit({ type: "text-delta", delta: event.delta });
        break;
      }
      case EventType.TEXT_MESSAGE_END: {
        endText(event.messageId);
        break;
      }
      case EventType.TEXT_MESSAGE_CHUNK: {
        if (!chunkMessageId) {
          chunkMessageId =
            event.messageId ?? `${runId}_chunk_${completedTexts.size}`;
          beginText(chunkMessageId, event.role);
        }
        if (event.role && event.role !== "assistant")
          throw new Error("Invalid external assistant message");
        texts.set(
          chunkMessageId,
          (texts.get(chunkMessageId) ?? "") + (event.delta ?? ""),
        );
        if (event.delta) emit({ type: "text-delta", delta: event.delta });
        break;
      }
      case EventType.TOOL_CALL_START:
        beginCall(event.toolCallId, event.toolCallName);
        break;
      case EventType.TOOL_CALL_CHUNK: {
        if (event.toolCallId && event.toolCallId !== chunkCallId) {
          if (!event.toolCallName)
            throw new Error("External tool chunk has no name");
          chunkCallId = event.toolCallId;
          beginCall(chunkCallId, event.toolCallName);
        }
        if (!chunkCallId) throw new Error("External tool chunk has no start");
        break;
      }
      case EventType.TOOL_CALL_RESULT: {
        const call = calls.get(event.toolCallId);
        if (!call) throw new Error("External tool result has no call");
        emit({
          type: "tool-end",
          callId: event.toolCallId,
          tool: `external:${call.name}`,
          ok: true,
          summary: "External harness returned a tool result",
          durationMs: Date.now() - call.startedAt,
        });
        calls.delete(event.toolCallId);
        break;
      }
      case EventType.MESSAGES_SNAPSHOT:
        for (const message of event.messages) {
          if (
            message.role !== "assistant" ||
            !message.content ||
            inputMessageIds.has(message.id)
          )
            continue;
          const streamed = completedTexts.get(message.id);
          if (streamed !== undefined) {
            if (streamed !== message.content)
              throw new Error(
                "External message snapshot differs from its streamed text",
              );
            continue;
          }
          beginText(message.id, message.role);
          texts.set(message.id, message.content);
          emit({ type: "text-delta", delta: message.content });
          endText(message.id);
        }
        break;
      case EventType.STATE_SNAPSHOT:
        state = event.snapshot;
        break;
      case EventType.STATE_DELTA: {
        const patch = z.array(operationSchema).max(1000).parse(event.delta);
        state = applyPatch(state, patch, true, false, true).newDocument;
        break;
      }
      case EventType.RUN_ERROR:
        throw new Error("The external harness reported a failed run");
      case EventType.RUN_FINISHED:
        if (
          event.threadId !== threadId ||
          event.runId !== runId ||
          texts.size ||
          calls.size ||
          event.outcome?.type === "interrupt"
        )
          throw new Error(
            "External harness did not complete its messages and tools",
          );
        finished = true;
        break;
      // Tool args are receipts, never instructions to call a local Ciele tool. Private reasoning is omitted.
    }
    if (JSON.stringify(state).length > 256000)
      throw new Error("External harness state exceeded the size limit");
  }
  if (!finished) throw new Error("External harness ended before RUN_FINISHED");
  if (!parts.length)
    throw new Error("External harness returned no assistant answer");
  if (options.turn.userMessageId) {
    const messages = [...completedTexts].filter(([, text]) => text);
    const identity = replyIdentitySchema.parse({
      userMessageId: options.turn.userMessageId,
      textHash: textHash(messages.map(([, text]) => text).join("\n")),
      messages: messages.map(([id, text]) => ({ id, length: text.length })),
    });
    const retained = [
      ...identities.filter(
        (entry) => entry.userMessageId !== identity.userMessageId,
      ),
      identity,
    ].slice(-40);
    while (JSON.stringify(retained).length > 256000) retained.shift();
    session?.set(identityKey, retained);
  }
  session?.set(stateKey, state);
  return {
    parts,
    effects: [],
    flowId: null,
    flowName: `External harness: ${connection.name}`,
    usage: [],
  };
}
