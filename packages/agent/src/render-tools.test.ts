import { describe, expect, it } from "vitest";
import type { Assistant } from "@agent-hub/core";

import { createTurnSession } from "./session";
import { buildToolset, type ToolRuntimeContext } from "./tools";
import { RENDER_TOOL_SPECS, replyComponentFor } from "./render-tools";
import { REPLY_COMPONENT_LIMITS } from "./reply-components";
import type { ChatReplyPart, RuntimeEvent } from "./types";

/**
 * The render catalogue (generative UI): a tool whose whole effect is a
 * component in front of the Visitor. What is under test is the contract that
 * makes that safe, the catalogue is closed, the props are validated, the part
 * is both streamed and collected, and the model is told to stop describing it.
 */

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: "assistant-1",
    organizationId: "org-1",
    title: "Assistant",
    nickname: "AI",
    description: "",
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: true,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    tools: { builtIns: { renderTable: true } },
    requireSignIn: false,
    knowledgeEngine: "graph",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolRuntimeContext> = {}) {
  const events: RuntimeEvent[] = [];
  const collected: ChatReplyPart[] = [];
  const ctx: ToolRuntimeContext = {
    assistant: makeAssistant(),
    session: createTurnSession("c1", {}),
    usedSources: [],
    searchPasses: [],
    emit: (event) => events.push(event),
    showPart: (part) => collected.push(part),
    ...overrides,
  };
  return { ctx, events, collected };
}

async function run(
  toolset: ReturnType<typeof buildToolset>,
  name: string,
  input: Record<string, unknown>,
  callId = "call-1"
) {
  const entry = toolset[name] as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return entry.execute(input, { toolCallId: callId, messages: [] });
}

function schemaFields(
  toolset: ReturnType<typeof buildToolset>,
  name: string
): string[] {
  const entry = toolset[name] as unknown as {
    inputSchema: { shape: Record<string, unknown> };
  };
  return Object.keys(entry.inputSchema.shape);
}

const TABLE = {
  title: "Piani",
  columns: ["Piano", "Prezzo"],
  rows: [
    ["Base", "9"],
    ["Pro", "29"],
  ],
};

describe("render catalogue registration", () => {
  it("is off unless the assistant enabled it", () => {
    const { ctx } = makeContext({ assistant: makeAssistant({ tools: {} }) });
    expect(Object.keys(buildToolset(ctx))).not.toContain("renderTable");
  });

  it("registers when enabled", () => {
    const { ctx } = makeContext();
    expect(Object.keys(buildToolset(ctx))).toContain("renderTable");
  });

  it("stays unregistered with no part collector wired", () => {
    // A component that streams to the Visitor but is never persisted would
    // leave the Inbox transcript disagreeing with what the chat showed, so the
    // whole catalogue is withheld rather than half-wired.
    const { ctx } = makeContext({ showPart: undefined });
    expect(Object.keys(buildToolset(ctx))).not.toContain("renderTable");
  });

  it("is narrated by Simplified thinking, like any other tool", () => {
    // The `progress` line rides the tool call, so a render tool narrates for
    // free. It never reaches the props: `takeProgress` strips it on the execute
    // path and `stripNonProps` strips it from the streamed arguments.
    const { ctx } = makeContext({ narrate: () => {} });
    const toolset = buildToolset(ctx);
    expect(schemaFields(toolset, "renderTable")).toContain("progress");
  });

  it("narrates before the component appears, and keeps the line out of props", async () => {
    const lines: Array<{ text: string; tool: string }> = [];
    const { ctx, collected } = makeContext({
      narrate: (text, tool) => lines.push({ text, tool }),
    });
    await run(buildToolset(ctx), "renderTable", {
      ...TABLE,
      progress: "Sto preparando la tabella dei piani…",
    });
    expect(lines).toEqual([
      { text: "Sto preparando la tabella dei piani…", tool: "renderTable" },
    ]);
    expect(collected[0]).toMatchObject({ props: { title: "Piani" } });
    expect((collected[0] as { props: Record<string, unknown> }).props).not.toHaveProperty(
      "progress"
    );
  });

  it("maps only its own tools to a component", () => {
    expect(replyComponentFor("renderTable")).toBe("table");
    expect(replyComponentFor("searchKnowledge")).toBeUndefined();
  });
});

describe("renderTable", () => {
  it("emits the part, collects it, and acknowledges to the model", async () => {
    const { ctx, events, collected } = makeContext();
    const output = await run(buildToolset(ctx), "renderTable", TABLE);

    const part = events.find((event) => event.type === "part");
    expect(part).toEqual({
      type: "part",
      part: {
        type: "component",
        action: "search_knowledge",
        name: "table",
        callId: "call-1",
        props: {
          title: "Piani",
          columns: ["Piano", "Prezzo"],
          rows: [
            ["Base", "9"],
            ["Pro", "29"],
          ],
        },
      },
    });
    // Streamed and collected are the SAME part: the transcript shows what the
    // Visitor saw, which is the reason the collector exists.
    expect(collected).toEqual([part && "part" in part ? part.part : null]);
    expect(output).toMatchObject({ shown: true });
    expect(String((output as { note: string }).note)).toContain("Refer to it");
  });

  it("never marks a part pending: that flag is the live client's alone", async () => {
    const { collected } = await (async () => {
      const made = makeContext();
      await run(buildToolset(made.ctx), "renderTable", TABLE);
      return made;
    })();
    expect(collected[0]).not.toHaveProperty("pending");
  });

  it("runs the full tool lifecycle, so the panel gets its row", async () => {
    const { ctx, events } = makeContext();
    await run(buildToolset(ctx), "renderTable", TABLE);
    expect(events.map((event) => event.type)).toEqual([
      "tool-start",
      "part",
      "tool-end",
    ]);
    const start = events[0];
    const end = events[2];
    expect(start).toMatchObject({
      type: "tool-start",
      tool: "renderTable",
      label: "Showing a table: Piani",
    });
    expect(end).toMatchObject({ type: "tool-end", ok: true, tool: "renderTable" });
  });

  it("squares a ragged grid instead of rendering a broken one", async () => {
    const { ctx, collected } = makeContext();
    await run(buildToolset(ctx), "renderTable", {
      columns: ["A", "B", "C"],
      rows: [["only-one"], ["a", "b", "c", "dropped"]],
    });
    expect(collected[0]).toMatchObject({
      props: {
        columns: ["A", "B", "C"],
        rows: [
          ["only-one", "", ""],
          ["a", "b", "c"],
        ],
      },
    });
  });

  it("refuses arguments it cannot render, and says so to the model", async () => {
    const { ctx, events, collected } = makeContext();
    const output = await run(buildToolset(ctx), "renderTable", {
      columns: [],
      rows: [],
    });
    expect(collected).toEqual([]);
    expect(events.some((event) => event.type === "part")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "tool-end", ok: false });
    expect(output).toMatchObject({
      error: expect.stringContaining("prose"),
    });
  });

  it("caps rows rather than refusing, so a runaway table still renders", () => {
    // It used to return null past the cap, which threw the whole table away
    // over one row too many. The shared normalizer trims instead.
    const spec = RENDER_TOOL_SPECS.find((entry) => entry.name === "renderTable");
    const rows = Array.from({ length: REPLY_COMPONENT_LIMITS.tableRows + 5 }, (_row, i) => [
      String(i),
    ]);
    const part = spec?.part({ columns: ["n"], rows }, "call-1");
    expect(
      (part as { props: { rows: string[][] } } | null | undefined)?.props.rows
    ).toHaveLength(REPLY_COMPONENT_LIMITS.tableRows);
  });

  it("carries per-row follow-up prompts, the thing a markdown table cannot do", async () => {
    const { ctx, collected } = makeContext();
    await run(buildToolset(ctx), "renderTable", {
      columns: ["Piano"],
      rows: [["Base"], ["Pro"]],
      askAbout: ["Cosa include Base?", ""],
    });
    expect(collected[0]).toMatchObject({
      props: { askAbout: ["Cosa include Base?", ""] },
    });
  });

  it("omits askAbout entirely when no row has a follow-up", async () => {
    const { ctx, collected } = makeContext();
    await run(buildToolset(ctx), "renderTable", TABLE);
    expect((collected[0] as { props: Record<string, unknown> }).props).not.toHaveProperty(
      "askAbout"
    );
  });
});
