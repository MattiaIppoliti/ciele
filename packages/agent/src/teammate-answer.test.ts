import { describe, expect, it, vi } from "vitest";
import type { Teammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";

import { createTurnSession } from "./session";
import {
  executeTeammateAnswer,
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
