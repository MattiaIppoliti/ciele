import { describe, expect, it, vi } from "vitest";
import type { Teammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";

import { createTurnSession } from "./session";
import {
  executeTeammateAnswer,
  projectTeammateUsage,
  runTeammateAnswer,
} from "./teammate-answer";
import type { RuntimeEvent } from "./types";

const teammate: Teammate = {
  id: "teammate-nora",
  organizationId: "org-1",
  ownerId: "member-1",
  name: "Nora",
  title: "Support writer",
  roleDescription: "Answer colleagues from the internal Library.",
  avatarSeed: "",
  editorIds: [],
  visibility: "org",
  collectionIds: [],
  sourceIds: [],
  modelProvider: "anthropic",
  modelId: "claude-opus-4-8",
  capabilityCeiling: "edit",
  systemKind: null,
  assistantId: null,
  approvalBypass: false,
  projectId: null,
  deletedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("runTeammateAnswer", () => {
  it("projects one AI Teammate through its built-in Flow and omits search for an empty Knowledge Scope", async () => {
    const events: RuntimeEvent[] = [];
    const result = await runTeammateAnswer({
      db: {} as Db,
      organizationId: teammate.organizationId,
      teammate,
      connections: [],
      conversationId: "conversation-1",
      turn: {
        platformPrompt: "Platform prompt",
        message: "Hello",
        history: [],
        session: createTurnSession("conversation-1", {}),
        emit: (event) => events.push(event),
        signal: new AbortController().signal,
      },
    });

    expect(result.flowId).toBe(`teammate-default:${teammate.id}`);
    expect(result.flowName).toBe("Teammate");
    expect(events.some((event) => event.type === "tool-start")).toBe(false);
  });

  it("owns trace, usage projection and telemetry for every container", async () => {
    const db = getMockDb();
    const telemetry = vi.spyOn(db, "recordRuntimeEvent");
    const events: RuntimeEvent[] = [];
    const outcome = await executeTeammateAnswer({
      db,
      organizationId: DEMO_ORG.id,
      teammate: { ...teammate, organizationId: DEMO_ORG.id },
      connections: [],
      conversationId: "conversation-1",
      turn: {
        platformPrompt: "Platform prompt",
        message: "Hello",
        history: [],
        session: createTurnSession("conversation-1", {}),
        emit: () => undefined,
        signal: new AbortController().signal,
      },
      forward: (event) => events.push(event),
      telemetry: {
        assistantId: null,
        conversationId: "conversation-1",
        surface: "teammate",
        startedAt: Date.now(),
      },
      attribution: { surface: "teammate", memberId: "member-1" },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.trace?.steps).toHaveLength(1);
    expect(outcome.usageRows("message-1")).toEqual([]);
    await outcome.recordSucceeded("message-1");
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: DEMO_ORG.id }),
    );
    expect(events.some((event) => event.type === "flow")).toBe(true);
  });
});

describe("projectTeammateUsage", () => {
  const usage = [
    {
      stage: "classify" as const,
      provider: "google" as const,
      modelId: "gemini-2.5-flash-lite",
      credentialKind: "platform" as const,
      inputTokens: 600,
      outputTokens: 20,
    },
    {
      stage: "generate" as const,
      provider: "anthropic" as const,
      modelId: "claude-opus-4-8",
      credentialKind: "platform" as const,
      inputTokens: 6000,
      outputTokens: 400,
    },
  ];

  function project(attribution: {
    surface: "teammate" | "channel" | "routine";
    memberId?: string | null;
    routineId?: string | null;
  }) {
    return projectTeammateUsage({
      usage,
      organizationId: DEMO_ORG.id,
      teammateId: teammate.id,
      telemetry: { assistantId: null, conversationId: "conversation-1" },
      attribution,
      messageId: "message-1",
    });
  }

  it("names the Teammate and the Member on every one of the turn's calls", () => {
    const rows = project({ surface: "teammate", memberId: "member-1" });
    expect(rows).toHaveLength(usage.length);
    for (const row of rows) {
      expect(row.spenders).toEqual({
        teammateId: teammate.id,
        memberId: "member-1",
        routineId: null,
      });
      expect(row.surface).toBe("teammate");
    }
    // Attribution is added to the row, not substituted for what was there:
    // the classify call is still a classify call on its own model.
    expect(rows[0]).toMatchObject({
      stage: "classify",
      modelId: "gemini-2.5-flash-lite",
      inputTokens: 600,
    });
  });

  it("names no Member for unattended work rather than borrowing one", () => {
    const rows = project({ surface: "routine", routineId: "routine-1" });
    expect(rows[0].spenders?.memberId).toBeNull();
    expect(rows[0].spenders?.teammateId).toBe(teammate.id);
    expect(rows[0].spenders?.routineId).toBe("routine-1");
    expect(rows[0].surface).toBe("routine");
  });

  it("carries the surface it was told, not the one the chat telemetry uses", () => {
    // A channel turn is a Teammate answer too, and folding it into "teammate"
    // would make a fan-out indistinguishable from a 1:1 chat.
    const rows = project({ surface: "channel", memberId: "member-1" });
    expect(rows.every((row) => row.surface === "channel")).toBe(true);
  });
});
