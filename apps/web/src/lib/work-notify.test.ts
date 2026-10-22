import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import type { EmailMessage } from "@agent-hub/agent";
import type { WorkNotificationRow } from "@ciele/ops";
import { raiseWorkNotifications } from "./work-notify";

const db = getMockDb();
const org = DEMO_ORG.id;

async function fixture() {
  const project = await db.table("projects").insert({
    organizationId: org,
    name: "Website",
    key: "WEB",
    createdBy: DEMO_MEMBER.userId,
  });
  const task = await db.table("tasks").insert({
    organizationId: org,
    projectId: project.id,
    seq: 7,
    title: "Fix the footer",
    rank: "a",
    createdBy: DEMO_MEMBER.userId,
  });
  const row = (recipientId: string, kind: WorkNotificationRow["kind"]): WorkNotificationRow => ({
    organizationId: org,
    recipientId,
    kind,
    projectId: project.id,
    taskId: task.id,
    commentId: null,
    actorMemberId: DEMO_MEMBER.userId,
    actorTeammateId: null,
  });
  return { row };
}

describe("raiseWorkNotifications", () => {
  beforeEach(() => resetMockDb());

  it("writes every row and emails only what each recipient's switches allow", async () => {
    const { row } = await fixture();
    await db.table("notificationPreferences").insert({ organizationId: org, userId: "u-andrea", emailMentioned: false });
    const sent: EmailMessage[] = [];
    await raiseWorkNotifications(
      db,
      [row("u-martina", "assigned"), row("u-andrea", "mentioned"), row("u-valeria", "commented")],
      async (message) => void sent.push(message)
    );
    expect(await db.table("memberNotifications").list({ organizationId: org })).toHaveLength(3);
    // Martina has no row, so every switch is on; Andrea turned mentions off;
    // a comment is never emailed.
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["martina.binacci@example.com", "WEB-7 was assigned to you: Fix the footer"]]);
  });

  it("names the Teammate that acted, not the Member who invoked it", async () => {
    const { row } = await fixture();
    const teammate = await db.table("teammates").insert({ organizationId: org, name: "Iris", title: "", ownerId: DEMO_MEMBER.userId });
    const sent: EmailMessage[] = [];
    await raiseWorkNotifications(
      db,
      [{ ...row("u-martina", "assigned"), actorTeammateId: teammate.id }],
      async (message) => void sent.push(message)
    );
    expect(sent[0]?.body).toMatch(/^Iris assigned WEB-7/);
  });

  it("never fails the write when the transport does", async () => {
    const { row } = await fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      raiseWorkNotifications(db, [row("u-martina", "assigned")], async () => {
        throw new Error("transport down");
      })
    ).resolves.toBeUndefined();
    expect(await db.table("memberNotifications").list({ organizationId: org })).toHaveLength(1);
    warn.mockRestore();
  });
});
