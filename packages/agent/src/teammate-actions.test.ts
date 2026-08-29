import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Assistant } from "@agent-hub/core";
import { createTurnSession } from "./session";
import { buildToolset, teammateActionToolName, type ToolRuntimeContext } from "./tools";
import type { RuntimeEvent, TeammateActionTool } from "./types";

/**
 * A granted Teammate action as a turn tool (#770).
 *
 * The runtime's half of the permission model is deliberately thin: it registers
 * what the host handed it and nothing else, so the cases here are about *shape*
 * (a legal tool name, the lifecycle events, the transcript card) rather than
 * about who may do what, which is the operations layer's test.
 */

function makeAssistant(): Assistant {
  return {
    id: "tm-1",
    organizationId: "org-1",
    title: "Nora",
    nickname: "Nora",
    description: "Support Copywriter",
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: false,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "vector",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

function action(over: Partial<TeammateActionTool> = {}): TeammateActionTool {
  return {
    operation: "improvements.update",
    domain: "improvements",
    label: "Move an improvement",
    description: "Change an improvement's status, priority or assignee.",
    inputSchema: z.object({ id: z.string(), status: z.string() }),
    run: async () => ({
      entities: [{ kind: "improvement", id: "IMP-3" }],
      result: { id: "IMP-3", status: "done" },
    }),
    ...over,
  };
}

function makeContext(actions: TeammateActionTool[]) {
  const events: RuntimeEvent[] = [];
  const ctx: ToolRuntimeContext = {
    assistant: makeAssistant(),
    session: createTurnSession("c1", {}),
    usedSources: [],
    searchPasses: [],
    teammateActions: actions,
    emit: (event) => events.push(event),
  };
  return { ctx, events };
}

/** The tools this context added on top of the always-on built-ins. */
function actionTools(ctx: ToolRuntimeContext): string[] {
  const { ctx: bare } = makeContext([]);
  const builtIns = new Set(Object.keys(buildToolset(bare)));
  return Object.keys(buildToolset(ctx)).filter((name) => !builtIns.has(name));
}

async function run(
  toolset: ReturnType<typeof buildToolset>,
  name: string,
  input: Record<string, unknown> = {}
) {
  const entry = toolset[name] as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return entry.execute(input, {
    toolCallId: `call-${name}`,
    messages: [],
  });
}

describe("granted actions as tools", () => {
  it("registers nothing for a Teammate with no granted actions", () => {
    const { ctx } = makeContext([]);
    // The whole permission model in one assertion: absence is refusal, and the
    // model is never told the tool exists to be refused. (The built-ins the
    // assistant path always registers are not actions and stay put.)
    expect(actionTools(ctx)).toEqual([]);
  });

  it("gives an operation name a legal tool name", () => {
    // The AI SDK will not take a dotted name, and the mapping has to be stable
    // because it is what the model calls back with.
    expect(teammateActionToolName("improvements.fix.accept")).toBe(
      "improvements_fix_accept"
    );
    const { ctx } = makeContext([
      action({ operation: "improvements.fix.accept" }),
    ]);
    expect(actionTools(ctx)).toEqual(["improvements_fix_accept"]);
  });

  it("records operation and entity on the transcript card", async () => {
    const { ctx, events } = makeContext([action()]);
    await run(buildToolset(ctx), "improvements_update", {
      id: "IMP-3",
      status: "done",
    });

    const end = events.find((event) => event.type === "tool-end");
    // The card is the audit: it names what ran and what it touched, both taken
    // from the operation's own declarations rather than a parallel description.
    expect(end).toMatchObject({
      tool: "improvements_update",
      ok: true,
      result: {
        operation: "improvements.update",
        domain: "improvements",
        entity: "improvement IMP-3",
      },
    });
  });

  it("says plainly when a read touched nothing", async () => {
    const { ctx, events } = makeContext([
      action({
        operation: "improvements.list",
        run: async () => ({ entities: [], result: [] }),
      }),
    ]);
    await run(buildToolset(ctx), "improvements_list");
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({
      result: { entity: "nothing (read only)" },
    });
  });

  it("emits the tool lifecycle with the action's own label", async () => {
    const { ctx, events } = makeContext([action()]);
    await run(buildToolset(ctx), "improvements_update", {
      id: "IMP-3",
      status: "done",
    });
    expect(events.find((e) => e.type === "tool-start")).toMatchObject({
      tool: "improvements_update",
      label: "Move an improvement",
    });
  });

  it("reports a failing action as a failed tool call, not a dead turn", async () => {
    const { ctx, events } = makeContext([
      action({
        run: async () => {
          throw new Error("This improvement was already done");
        },
      }),
    ]);
    const output = await run(buildToolset(ctx), "improvements_update", {
      id: "IMP-3",
      status: "done",
    });
    // The model gets the reason and can tell its colleague; the turn continues.
    expect(output).toMatchObject({ error: "This improvement was already done" });
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({ ok: false });
  });

  it("truncates an oversized result instead of pasting it into the context", async () => {
    const huge = Array.from({ length: 2000 }, (_, i) => ({
      id: `conv-${i}`,
      title: "a".repeat(40),
    }));
    const { ctx } = makeContext([
      action({
        operation: "inbox.conversations.list",
        run: async () => ({ entities: [], result: huge }),
      }),
    ]);
    const output = (await run(
      buildToolset(ctx),
      "inbox_conversations_list"
    )) as { truncated?: boolean; totalLength?: number; preview?: string };
    expect(output.truncated).toBe(true);
    expect(output.totalLength).toBeGreaterThan(8_000);
    expect(output.preview?.length).toBe(8_000);
  });

  it("passes a small result through untouched", async () => {
    const { ctx } = makeContext([action()]);
    const output = await run(buildToolset(ctx), "improvements_update", {
      id: "IMP-3",
      status: "done",
    });
    expect(output).toMatchObject({ id: "IMP-3", status: "done" });
  });
});
