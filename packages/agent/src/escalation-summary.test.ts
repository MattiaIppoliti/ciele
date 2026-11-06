import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { summariseEscalation } from "./escalation-summary";

function message(role: StoredMessage["role"], text: string): StoredMessage {
  return {
    id: `m-${Math.random()}`,
    conversationId: "c-1",
    role,
    content: [{ type: "text", text }],
    flowId: null,
    flowName: null,
    feedback: 0,
    trace: null,
    createdAt: "2026-10-21T10:00:00.000Z",
  };
}

describe("summariseEscalation (#1081)", () => {
  it("summarises nothing before the Visitor wrote, and asks no model", async () => {
    const db = getMockDb();
    const connections = vi.spyOn(db, "listProviderConnections");
    expect(
      await summariseEscalation({
        db,
        organizationId: DEMO_ORG.id,
        assistantId: "a-1",
        messages: [message("assistant", "Welcome!")],
      })
    ).toBeNull();
    expect(connections).not.toHaveBeenCalled();
  });

  it("returns null rather than failing when no connection can answer", async () => {
    const db = getMockDb();
    vi.spyOn(db, "listProviderConnections").mockResolvedValue([]);
    expect(
      await summariseEscalation({
        db,
        organizationId: DEMO_ORG.id,
        assistantId: "a-1",
        messages: [message("user", "My order never arrived")],
      })
    ).toBeNull();
  });

  it("returns null rather than failing when the connection read throws", async () => {
    const db = getMockDb();
    vi.spyOn(db, "listProviderConnections").mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await summariseEscalation({
        db,
        organizationId: DEMO_ORG.id,
        assistantId: "a-1",
        messages: [message("user", "Help")],
      })
    ).toBeNull();
  });
});
