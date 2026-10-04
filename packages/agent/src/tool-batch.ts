import type { ModelMessage, Tool, ToolExecutionOptions, ToolSet, TypedToolCall, ToolResultPart } from "ai";
import { createToolModelOutput } from "ai/internal";

/** Safe readers return effects to commit; they never publish shared state while running. */
interface PreparedRead {
  run: () => Promise<unknown>;
  commit: () => void;
}
type PrepareRead = (input: Record<string, unknown>, options: ToolExecutionOptions<unknown>) => PreparedRead;
const readers = new WeakMap<Tool, PrepareRead>();

export function registerParallelRead(tool: Tool, prepare: PrepareRead): void {
  readers.set(tool, prepare);
}

/** The model sees schemas only. Admission completes before any body can run. */
export function modelToolDeclarations(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, entry]) => {
    const { execute: _execute, onInputAvailable: _onInputAvailable, onInputStart: _onInputStart, onInputDelta: _onInputDelta, ...declaration } = entry;
    return [name, declaration];
  }));
}

/** One ordered batch. Unknown tools are barriers; started bodies always drain. */
export async function dispatchToolBatch(input: {
  calls: readonly TypedToolCall<ToolSet>[];
  tools: ToolSet;
  messages: ModelMessage[];
  signal?: AbortSignal;
  stopped?: () => boolean;
  skipped?: (call: TypedToolCall<ToolSet>, reason: string) => void;
}): Promise<ToolResultPart[]> {
  const ids = new Set<string>();
  for (const call of input.calls) {
    if (ids.has(call.toolCallId)) throw new Error("Duplicate tool call ID in model step");
    ids.add(call.toolCallId);
  }
  const results: ToolResultPart[] = [];
  const reason = () => input.signal?.aborted ? "Cancelled before execution" : input.stopped?.() ? "Skipped after terminal declaration" : null;
  const prepare = (call: TypedToolCall<ToolSet>) => {
    const entry = Object.hasOwn(input.tools, call.toolName) ? input.tools[call.toolName] : undefined;
    const options = { toolCallId: call.toolCallId, messages: input.messages, abortSignal: input.signal, context: undefined };
    const read = !call.invalid && entry ? readers.get(entry) : undefined;
    return { call, entry, read: read?.(call.input, options), options };
  };
  const run = async (prepared: ReturnType<typeof prepare>) => {
    let output: unknown;
    let errorMode: "none" | "text" = "none";
    const skipped = reason();
    try {
      if (skipped) {
        input.skipped?.(prepared.call, skipped);
        output = skipped;
        errorMode = "text";
      } else if (prepared.call.invalid) {
        throw prepared.call.error ?? new Error("Arguments rejected");
      } else if (!prepared.entry?.execute) {
        throw new Error("Tool is unavailable");
      } else {
        const value = prepared.read
          ? await prepared.read.run()
          : await prepared.entry.execute(prepared.call.input, prepared.options);
        // Support SDK tools with streamed outputs without leaving their body running.
        if (value && typeof value === "object" && Symbol.asyncIterator in value) {
          for await (const item of value) output = item;
        } else output = value;
      }
    } catch (error) {
      output = error instanceof Error ? error.message : "Tool execution failed";
      errorMode = "text";
    }
    let modelOutput;
    try {
      modelOutput = await createToolModelOutput({ toolCallId: prepared.call.toolCallId, input: prepared.call.input, output, tool: prepared.entry, errorMode });
    } catch {
      modelOutput = { type: "error-text" as const, value: "Tool output could not be serialized. The operation may have completed; do not repeat it." };
    }
    return {
      commit: prepared.read?.commit,
      part: {
        type: "tool-result" as const,
        toolCallId: prepared.call.toolCallId,
        toolName: prepared.call.toolName,
        output: modelOutput,
      },
    };
  };
  const admitted = input.calls.map(prepare);
  // Contiguous groups, with a maximum of four reads in flight. A mutation waits
  // for all preceding bodies and commits before any following read can start.
  for (let index = 0; index < input.calls.length;) {
    const first = admitted[index]!;
    const group = [first];
    index += 1;
    if (first.read && !reason()) {
      while (index < input.calls.length && group.length < 4) {
        const next = admitted[index]!;
        if (!next.read) break;
        group.push(next);
        index += 1;
      }
    }
    const settled = await Promise.all(group.map(run));
    for (const outcome of settled) {
      outcome.commit?.();
      results.push(outcome.part);
    }
  }
  return results;
}
