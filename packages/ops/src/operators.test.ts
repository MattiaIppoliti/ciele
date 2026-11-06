import { describe, expect, it } from "vitest";
import { roleAllowsCapability } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Role } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import {
  listWaitingConversationsOp,
  releaseConversationOp,
  replyToConversationOp,
  takeOverConversationOp,
} from "./operators";
import { TEAMMATE_ACTION_CATALOG } from "./teammate-actions";

const db = getMockDb();

function context(userId: string, name: string, role: Role = "editor"): OperationContext {
  return { organizationId: DEMO_ORG.id, userId, role, actorName: name, db, ports: {} };
}

async function visitorConversation() {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Operator test" });
  return db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: `visitor-${Math.random()}`,
    title: "Help",
  });
}

describe("taking a Conversation over (#1082)", () => {
  it("lets one Member hold it, and tells a second who already does", async () => {
    const conversation = await visitorConversation();
    const dana = context(DEMO_MEMBER.userId, "Dana");
    const { conversation: held, line } = await takeOverConversationOp.run(dana, { id: conversation.id });
    expect(held.operator).toMatchObject({ state: "held", memberName: "Dana" });
    expect(line).toMatchObject({ role: "system", content: [{ type: "text", text: "Dana joined the conversation" }] });

    await expect(
      takeOverConversationOp.run(context("u-other", "Lee"), { id: conversation.id })
    ).rejects.toThrow(/Dana is already answering/);
  });

  it("saves a reply from the holder as an operator message and refuses anyone else's", async () => {
    const conversation = await visitorConversation();
    const dana = context(DEMO_MEMBER.userId, "Dana");
    await expect(replyToConversationOp.run(dana, { id: conversation.id, text: "Hi" })).rejects.toThrow(
      /Take the conversation over/
    );
    await takeOverConversationOp.run(dana, { id: conversation.id });
    const reply = await replyToConversationOp.run(dana, { id: conversation.id, text: "Hi, Dana here." });
    expect(reply).toMatchObject({ role: "operator", authorName: "Dana", feedback: 0 });
    await expect(
      replyToConversationOp.run(context("u-other", "Lee"), { id: conversation.id, text: "Me too" })
    ).rejects.toThrow(/Dana is answering/);
  });

  it("hands it back on release, and lets an admin release a colleague's", async () => {
    const conversation = await visitorConversation();
    const dana = context(DEMO_MEMBER.userId, "Dana");
    await takeOverConversationOp.run(dana, { id: conversation.id });
    await expect(
      releaseConversationOp.run(context("u-other", "Lee", "editor"), { id: conversation.id })
    ).rejects.toThrow(/Only the Member answering/);
    const { conversation: released, line } = await releaseConversationOp.run(
      context("u-admin", "Ana", "admin"),
      { id: conversation.id }
    );
    expect(released.operator?.state).toBe("ai");
    expect(line.content).toEqual([
      { type: "text", text: "Dana left the conversation. The assistant will answer from here." },
    ]);
  });

  it("declares a named capability a Viewer does not have, and reply as consequential", () => {
    for (const op of [takeOverConversationOp, replyToConversationOp, releaseConversationOp]) {
      expect(op.capability).toBe("inbox:operate");
    }
    expect(replyToConversationOp.effect).toBe("consequential");
    expect(roleAllowsCapability("viewer", "operate")).toBe(false);
    expect(roleAllowsCapability("editor", "operate")).toBe(true);
  });

  it("lists live waits oldest first with their desk, and drops a wait that ran out (#1083)", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Front desk" });
    const older = await visitorConversation();
    const newer = await visitorConversation();
    const expired = await visitorConversation();
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    for (const [conversation, startedAt] of [
      [newer, minutesAgo(1)],
      [older, minutesAgo(3)],
      [expired, minutesAgo(30)],
    ] as const) {
      await db.startConversationWait({
        conversationId: conversation.id,
        helpDeskId: desk.id,
        channelId: "live",
        timeoutMinutes: 5,
        now: startedAt,
      });
    }
    const queue = await listWaitingConversationsOp.run(context(DEMO_MEMBER.userId, "Dana", "viewer"), {});
    const ours = queue.filter((row) => [older.id, newer.id, expired.id].includes(row.conversationId));
    expect(ours.map((row) => row.conversationId)).toEqual([older.id, newer.id]);
    expect(ours[0]).toMatchObject({ helpDeskName: "Front desk", assignedMemberId: null });
    expect(ours[0]!.waitedMs).toBeGreaterThanOrEqual(3 * 60_000 - 1_000);

    // Taking it over ends the wait.
    await takeOverConversationOp.run(context(DEMO_MEMBER.userId, "Dana"), { id: older.id });
    const after = await listWaitingConversationsOp.run(context(DEMO_MEMBER.userId, "Dana", "viewer"), {});
    expect(after.map((row) => row.conversationId)).not.toContain(older.id);
  });

  it("is not in a Teammate's curated catalogue", () => {
    const names = Object.values(TEAMMATE_ACTION_CATALOG).flat().map((entry) => entry.operation.name);
    expect(names).not.toContain("inbox.conversations.takeover");
    expect(names).not.toContain("inbox.conversations.reply");
    expect(names).not.toContain("inbox.conversations.release");
  });
});
