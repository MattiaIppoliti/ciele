import { describe, expect, it } from "vitest";
import { tool, type ToolSet, type TypedToolCall } from "ai";
import { z } from "zod";
import { dispatchToolBatch, modelToolDeclarations, registerParallelRead } from "./tool-batch";

const call = (name: string, id = name): TypedToolCall<ToolSet> => ({ type: "tool-call", toolCallId: id, toolName: name, input: {} });
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function fixture() {
  const events: string[] = [];
  const tools: ToolSet = {};
  const add = (name: string, read: boolean, body: () => Promise<unknown>) => {
    const entry = tool({ inputSchema: z.object({}), execute: body });
    tools[name] = entry;
    if (read) registerParallelRead(entry, () => ({ run: body, commit: () => { events.push(`commit:${name}`); } }));
  };
  return { tools, events, add };
}

describe("ordered tool batches", () => {
  it("runs safe reads together, commits model order, and places mutations between groups", async () => {
    const { tools, events, add } = fixture();
    const a = latch();
    add("a", true, async () => { events.push("start:a"); await a.promise; return "A"; });
    add("b", true, async () => { events.push("start:b"); a.release(); return "B"; });
    add("write", false, async () => { events.push("write"); return "written"; });
    add("c", true, async () => { events.push("start:c"); return "C"; });
    const results = await dispatchToolBatch({ tools, calls: [call("a"), call("b"), call("write"), call("c")], messages: [] });
    expect(events).toEqual(["start:a", "start:b", "commit:a", "commit:b", "write", "start:c", "commit:c"]);
    expect(results.map(result => result.toolCallId)).toEqual(["a", "b", "write", "c"]);
  });

  it("bounds read concurrency to four", async () => {
    const { tools, add } = fixture();
    let active = 0;
    let maximum = 0;
    for (let i = 0; i < 12; i += 1) add(`${i}`, true, async () => {
      active += 1; maximum = Math.max(maximum, active);
      await Promise.resolve(); active -= 1;
      return i;
    });
    await dispatchToolBatch({ tools, calls: Array.from({ length: 12 }, (_, i) => call(`${i}`)), messages: [] });
    expect(maximum).toBe(4);
  });

  it("drains started work after cancellation and never starts the following mutation", async () => {
    const { tools, events, add } = fixture();
    const body = latch();
    const started = latch();
    const controller = new AbortController();
    add("read", true, async () => { started.release(); await body.promise; events.push("drained"); return "read"; });
    add("write", false, async () => { events.push("write"); });
    const skipped: string[] = [];
    const pending = dispatchToolBatch({ tools, calls: [call("read"), call("write")], messages: [], signal: controller.signal, skipped: c => skipped.push(c.toolCallId) });
    await started.promise;
    controller.abort();
    let finished = false;
    void pending.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    body.release();
    const results = await pending;
    expect(events).toEqual(["drained", "commit:read"]);
    expect(skipped).toEqual(["write"]);
    expect(results[1]?.output.type).toBe("error-text");
  });

  it("treats unspecified tools as exclusive and skips calls after a terminal declaration", async () => {
    const { tools, events, add } = fixture();
    let terminal = false;
    add("ready", false, async () => { terminal = true; return "ready"; });
    add("write", false, async () => { events.push("write"); });
    const results = await dispatchToolBatch({ tools, calls: [call("ready"), call("write")], messages: [], stopped: () => terminal });
    expect(events).toEqual([]);
    expect(results[1]?.output).toMatchObject({ type: "error-text", value: "Skipped after terminal declaration" });
  });

  it("rejects duplicate IDs before executing any body", async () => {
    const { tools, events, add } = fixture();
    add("write", false, async () => { events.push("write"); });
    await expect(dispatchToolBatch({ tools, calls: [call("write"), call("write")], messages: [] })).rejects.toThrow("Duplicate");
    expect(events).toEqual([]);
  });

  it("does not prepare an isolated read with rejected arguments", async () => {
    const read = tool({ inputSchema: z.object({ name: z.string() }), execute: async () => "unused" });
    registerParallelRead(read, () => { throw new Error("Invalid arguments reached read preparation"); });
    const { tools, events, add } = fixture();
    add("write", false, async () => { events.push("write"); return "written"; });
    const results = await dispatchToolBatch({ tools: { ...tools, read }, calls: [
      { ...call("read"), dynamic: true, invalid: true, error: new Error("Arguments rejected") }, call("write"),
    ], messages: [] });
    expect(results[0]?.output).toMatchObject({ type: "error-text", value: "Arguments rejected" });
    expect(events).toEqual(["write"]);
  });

  it("drains sibling readers when output serialization fails", async () => {
    const sibling = latch();
    const started = latch();
    const events: string[] = [];
    const broken = tool({ inputSchema: z.object({}), execute: async () => "completed", toModelOutput: async () => { throw new Error("serialization failed"); } });
    const slow = tool({ inputSchema: z.object({}), execute: async () => "unused" });
    registerParallelRead(broken, () => ({ run: async () => "completed", commit: () => events.push("broken") }));
    registerParallelRead(slow, () => ({ run: async () => { started.release(); await sibling.promise; return "drained"; }, commit: () => events.push("slow") }));
    const pending = dispatchToolBatch({ tools: { broken, slow }, calls: [call("broken"), call("slow")], messages: [] });
    await started.promise;
    let finished = false;
    void pending.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    sibling.release();
    const results = await pending;
    expect(events).toEqual(["broken", "slow"]);
    expect(results[0]?.output).toMatchObject({ type: "error-text", value: expect.stringContaining("may have completed") });
    expect(results[1]?.output.type).not.toBe("error-text");
  });

  it("keeps execution and input-available hooks out of model admission", () => {
    const tools: ToolSet = { write: tool({ inputSchema: z.object({}), execute: async () => "write", onInputAvailable: () => { throw new Error("premature execution"); } }) };
    expect(modelToolDeclarations(tools).write?.execute).toBeUndefined();
    expect(modelToolDeclarations(tools).write?.onInputAvailable).toBeUndefined();
  });
});
