import { describe, expect, it } from "vitest";
import {
  computerActivity,
  computerTurnActivity,
  computerScreenSchema,
  computerStatusSchema,
  terminalActivity,
} from "./computer-view";
import type { TurnStep } from "@agent-hub/core";
describe("computer view", () => {
  it("keeps only safe operational computer traces and identifies terminal commands", () => {
    const steps: TurnStep[] = [
      {
        id: "thought",
        kind: "thought",
        label: "Private reasoning",
        status: "done",
        tool: "computer_exec",
      },
      {
        id: "other",
        kind: "tool",
        label: "Other tool",
        status: "done",
        tool: "searchKnowledge",
      },
      {
        id: "screen",
        kind: "tool",
        label: "Navigate",
        status: "running",
        tool: "computer_navigate",
      },
      {
        id: "exec",
        kind: "tool",
        label: "Command",
        status: "done",
        tool: "computer_exec",
        result: { output: { stdout: "complete" } },
      },
    ];
    expect(computerActivity(steps).map((step) => step.id)).toEqual([
      "screen",
      "exec",
    ]);
    expect(terminalActivity(steps).map((step) => step.id)).toEqual(["exec"]);
  });
  it("rejects malformed frames and does not grant management when absent", () => {
    expect(
      computerScreenSchema.safeParse({
        base64: "javascript:alert(1)",
        width: 0,
        height: 1,
        capturedAt: "yesterday",
        url: "",
      }).success,
    ).toBe(false);
    expect(
      computerStatusSchema.parse({
        state: "running",
        permissions: { browser: true, files: false, terminal: false },
      }).canManage,
    ).toBe(false);
  });

  it("opens the live card at tool start, before an answer or result exists", () => {
    const step: TurnStep = { id: "navigate", kind: "tool", tool: "computer_navigate", label: "Computer: navigate", status: "running" };
    expect(computerTurnActivity([step], { latestCallId: step.id, live: true })).toMatchObject({
      id: "navigate", current: true, live: true, status: "Running", step,
    });
  });

  it("keeps one stable card identity across multiple computer actions in a turn", () => {
    const first: TurnStep = { id: "navigate", kind: "tool", tool: "computer_navigate", label: "Navigate", status: "done" };
    const second: TurnStep = { id: "exec", kind: "tool", tool: "computer_exec", label: "Command", status: "running" };
    expect(computerTurnActivity([first, second], { latestCallId: second.id, live: true })).toMatchObject({
      id: first.id, step: second, current: true, live: true,
    });
  });

  it("does not pass private reasoning or unrelated tools into a screen card", () => {
    const steps: TurnStep[] = [
      { id: "reasoning", kind: "thought", tool: "computer_exec", label: "Private reasoning", status: "running" },
      { id: "knowledge", kind: "tool", tool: "searchKnowledge", label: "Search", status: "running" },
    ];
    expect(computerTurnActivity(steps, { latestCallId: undefined, live: true })).toBeNull();
  });

  it("distinguishes earlier receipts from the current screen and does not revive unfinished stored calls", () => {
    const step: TurnStep = { id: "older", kind: "tool", tool: "computer.exec", label: "Command", status: "running" };
    expect(computerTurnActivity([step], { latestCallId: "newer", live: false })).toMatchObject({
      current: false, live: false, status: "Interrupted",
    });
  });

  it.each([ ["done", "Completed"], ["error", "Failed"] ] as const)("reports a %s computer operation without a live badge", (status, label) => {
    const step: TurnStep = { id: "call", kind: "tool", tool: "computer_scroll", label: "Scroll", status };
    expect(computerTurnActivity([step], { latestCallId: step.id, live: true })).toMatchObject({
      current: true, live: false, status: label,
    });
  });
});
