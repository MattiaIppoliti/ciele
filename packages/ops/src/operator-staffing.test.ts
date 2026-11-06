import { describe, expect, it, vi } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  assignWaitingConversations,
  desksWithAvailableOperator,
  setHelpDeskOperatorsOp,
  setOperatorStatusOp,
} from "./operator-staffing";
import { notificationTriageOp, markNotificationsOp } from "./member-notifications";
import { releaseConversationOp, takeOverConversationOp } from "./operators";

const db = getMockDb();

function context(userId: string, role: Role = "editor"): OperationContext {
  return { organizationId: DEMO_ORG.id, userId, role, actorName: userId, db, ports: {} };
}

async function waitingConversation(helpDeskId: string, startedMinutesAgo = 0) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Staffing test" });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: `visitor-${Math.random()}`,
    title: "Help",
  });
  await db.startConversationWait({
    conversationId: conversation.id,
    helpDeskId,
    channelId: "live",
    timeoutMinutes: 30,
    now: new Date(Date.now() - startedMinutesAgo * 60_000).toISOString(),
  });
  return conversation;
}

const members = async () => (await db.listMembers(DEMO_ORG.id)).map((member) => member.userId);

describe("operators per Help Desk (#1084)", () => {
  it("staffs a desk with Members of the Organization only", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Staffed" });
    const [first] = await members();
    const rows = await setHelpDeskOperatorsOp.run(context(DEMO_MEMBER.userId), {
      helpDeskId: desk.id,
      operators: [{ memberId: first!, capacity: 3 }],
    });
    expect(rows.map((row) => [row.memberId, row.capacity])).toEqual([[first, 3]]);
    await expect(
      setHelpDeskOperatorsOp.run(context(DEMO_MEMBER.userId), {
        helpDeskId: desk.id,
        operators: [{ memberId: "not-a-member", capacity: 3 }],
      })
    ).rejects.toThrow(/Member of the Organization/);
  });

  it("offers the channel only while an operator of the desk is Available, and assigns as they arrive", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Arrivals" });
    const [first, second] = await members();
    await setHelpDeskOperatorsOp.run(context(DEMO_MEMBER.userId), {
      helpDeskId: desk.id,
      operators: [
        { memberId: first!, capacity: 1 },
        { memberId: second!, capacity: 1 },
      ],
    });
    await setOperatorStatusOp.run(context(first!), { status: "away" });
    await setOperatorStatusOp.run(context(second!), { status: "away" });
    expect((await desksWithAvailableOperator(db, DEMO_ORG.id)).has(desk.id)).toBe(false);

    // Nobody free: the wait stays unassigned in the queue.
    const older = await waitingConversation(desk.id, 2);
    const newer = await waitingConversation(desk.id, 1);
    const none = await assignWaitingConversations(db, DEMO_ORG.id);
    expect(none.filter((row) => [older.id, newer.id].includes(row.conversationId))).toEqual([]);

    // Coming back Available assigns the oldest wait to the one who arrived.
    await setOperatorStatusOp.run(context(first!), { status: "available" });
    expect((await desksWithAvailableOperator(db, DEMO_ORG.id)).has(desk.id)).toBe(true);
    expect((await db.getConversation(older.id))?.operator?.assignedMemberId).toBe(first);
    // At capacity (1), so the newer wait is still unassigned.
    expect((await db.getConversation(newer.id))?.operator?.assignedMemberId).toBeNull();

    // The second operator comes back: the newer wait goes to them.
    await setOperatorStatusOp.run(context(second!), { status: "available" });
    expect((await db.getConversation(newer.id))?.operator?.assignedMemberId).toBe(second);

    // The shared demo Db outlives this case: leave nobody loaded.
    await db.deleteConversation(older.id);
    await db.deleteConversation(newer.id);
  });

  it("assigns a waiting Visitor when an operator frees up by releasing", async () => {
    const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Releases" });
    const [first] = await members();
    await setHelpDeskOperatorsOp.run(context(DEMO_MEMBER.userId), {
      helpDeskId: desk.id,
      operators: [{ memberId: first!, capacity: 1 }],
    });
    await setOperatorStatusOp.run(context(first!), { status: "available" });
    const held = await waitingConversation(desk.id, 3);
    await assignWaitingConversations(db, DEMO_ORG.id);
    await takeOverConversationOp.run(context(first!), { id: held.id });

    const next = await waitingConversation(desk.id, 1);
    await assignWaitingConversations(db, DEMO_ORG.id);
    expect((await db.getConversation(next.id))?.operator?.assignedMemberId).toBeNull();

    await releaseConversationOp.run(context(first!), { id: held.id });
    expect((await db.getConversation(next.id))?.operator?.assignedMemberId).toBe(first);
  });

  it("refuses a status from a Viewer, who does not answer Visitors", () => {
    expect(setOperatorStatusOp.capability).toBe("inbox:operate");
  });
});

it("stops offering an expired console lease and leaves a durable notification for its assignment", async () => {
  const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Lease and notification" });
  const memberId = DEMO_MEMBER.userId;
  await setHelpDeskOperatorsOp.run(context(memberId), { helpDeskId: desk.id, operators: [{ memberId, capacity: 3 }] });
  const conversation = await waitingConversation(desk.id);
  const now = new Date(); vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    await setOperatorStatusOp.run(context(memberId), { status: "available" });
    const notifications = await db.table("memberNotifications").list({ recipientId: memberId, conversationId: conversation.id });
    expect(notifications).toHaveLength(1);
    expect((await notificationTriageOp.run(context(memberId), {})).find(row => row.id === notifications[0]?.id)).toMatchObject({ conversation: { id: conversation.id }, task: null });
    await markNotificationsOp.run(context(memberId), markNotificationsOp.input.parse({ ids: [notifications[0]!.id], read: true }));
    expect((await notificationTriageOp.run(context(memberId), { unreadOnly: true })).some(row => row.id === notifications[0]?.id)).toBe(false);
    expect(notifications[0]).toMatchObject({ kind: "conversation_assigned", taskId: null, projectId: null });
    vi.setSystemTime(new Date(now.getTime() + 121_000));
    expect((await desksWithAvailableOperator(db, DEMO_ORG.id)).has(desk.id)).toBe(false);
    expect(await setOperatorStatusOp.run(context(memberId), { status: "available", renewOnly: true })).toMatchObject({ status: "away" });
    await setOperatorStatusOp.run(context(memberId), { status: "away" });
    expect(await setOperatorStatusOp.run(context(memberId), { status: "available", renewOnly: true })).toMatchObject({ status: "away" });
  } finally { vi.useRealTimers(); }
});

it("does not offer a desk whose Available operator has left the Organization", async () => {
  const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Departed operator" });
  await setHelpDeskOperatorsOp.run(context(DEMO_MEMBER.userId), { helpDeskId: desk.id, operators: [{ memberId: DEMO_MEMBER.userId, capacity: 3 }] });
  await setOperatorStatusOp.run(context(DEMO_MEMBER.userId), { status: "available" });
  const members = await db.listMembers(DEMO_ORG.id);
  const read = vi.spyOn(db, "listMembers").mockResolvedValue(members.filter(member => member.userId !== DEMO_MEMBER.userId));
  try { expect((await desksWithAvailableOperator(db, DEMO_ORG.id)).has(desk.id)).toBe(false); }
  finally { read.mockRestore(); await setOperatorStatusOp.run(context(DEMO_MEMBER.userId), { status: "away" }); }
});

it("keeps one capacity slot under two concurrent assignment sweeps", async () => {
  const organizationId = "operator-race-org";
  const ctx = { ...context(DEMO_MEMBER.userId), organizationId };
  const desk = await db.createHelpDesk(organizationId, { name: "Concurrent assignment" });
  const assistant = await db.createAssistant(organizationId, { title: "Concurrent Visitors" });
  await setHelpDeskOperatorsOp.run(ctx, { helpDeskId: desk.id, operators: [{ memberId: DEMO_MEMBER.userId, capacity: 1 }] });
  await setOperatorStatusOp.run(ctx, { status: "available" });
  const conversations = [];
  for (const subjectId of ["race-one", "race-two"]) {
    const conversation = await db.createConversation({ assistantId: assistant.id, subjectType: "visitor", subjectId });
    await db.startConversationWait({ conversationId: conversation.id, helpDeskId: desk.id, channelId: "live", timeoutMinutes: 30, now: new Date().toISOString() });
    conversations.push(conversation);
  }
  await Promise.all([assignWaitingConversations(db, organizationId), assignWaitingConversations(db, organizationId)]);
  const assigned = await Promise.all(conversations.map(row => db.getConversation(row.id)));
  expect(assigned.filter(row => row?.operator?.assignedMemberId === DEMO_MEMBER.userId)).toHaveLength(1);
});
