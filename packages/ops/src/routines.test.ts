import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import {
  AUTO_IMPROVEMENT_LABEL,
  TEAMMATE_ROUTINE_CAP,
} from "@agent-hub/core";
import {
  DEMO_MEMBER,
  DEMO_ORG,
  createOrgPinnedDb,
  getMockDb,
} from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { OperationError, type OperationContext, type TeammateActor } from "./operation";
import {
  createRoutineOp,
  deleteRoutineOp,
  listRoutinesOp,
  updateRoutineOp,
} from "./routines";
import { triageFeedbackOp } from "./improvements";
import { createTeammateOp } from "./teammates";

/**
 * Routine CRUD and the feedback-triage template (#772).
 *
 * The template's tests are the interesting half, and they are all about what
 * it *refuses* to do: it files at most five, it never files a second item for
 * a problem already open, and it labels everything it files. A scheduled job
 * that can flood a board is worse than no scheduled job.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

const pinned = (inner: Db) => createOrgPinnedDb(inner, DEMO_ORG.id);

const actor = (over: Partial<TeammateActor> = {}): TeammateActor => ({
  id: "tm-1",
  name: "Nora",
  ceiling: "edit",
  grants: ["improvements"],
  approvalBypass: false,
  projectId: null,
  ...over,
});

describe("routine CRUD", () => {
  it("caps at five per Teammate, with a refusal somebody can act on", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });
    for (let i = 0; i < TEAMMATE_ROUTINE_CAP; i++) {
      await createRoutineOp.run(context, {
        teammateId: teammate.id,
        instruction: `Routine ${i}`,
        cadence: "daily",
        hour: 8,
      });
    }
    await expect(
      createRoutineOp.run(context, {
        teammateId: teammate.id,
        instruction: "One too many",
        cadence: "daily",
        hour: 8,
      })
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Delete or disable one"),
    });
  });

  it("offers cadence presets and refuses anything else", () => {
    expect(
      createRoutineOp.input.safeParse({
        teammateId: "tm-1",
        instruction: "x",
        cadence: "0 8 * * *",
      }).success
    ).toBe(false);
    for (const cadence of ["daily", "weekly", "monthly"]) {
      expect(
        createRoutineOp.input.safeParse({
          teammateId: "tm-1",
          instruction: "x",
          cadence,
        }).success
      ).toBe(true);
    }
    // An hour outside the clock is not an hour.
    expect(
      createRoutineOp.input.safeParse({
        teammateId: "tm-1",
        instruction: "x",
        cadence: "daily",
        hour: 24,
      }).success
    ).toBe(false);
  });

  it("is governed by the Teammate's own ownership rule, not a new one", async () => {
    const db = getMockDb();
    const teammate = await createTeammateOp.run(ctx({ db }), {
      name: "Nora",
      visibility: "private",
    });
    const stranger = ctx({ db, role: "viewer" as Role, userId: "u-stranger" });
    // A Viewer cannot edit a Teammate, so they cannot give it standing
    // instructions either, and a private one is hidden rather than forbidden.
    await expect(
      createRoutineOp.run(stranger, {
        teammateId: teammate.id,
        instruction: "x",
        cadence: "daily",
        hour: 8,
      })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      listRoutinesOp.run(stranger, { teammateId: teammate.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("reaches a routine only through the Teammate that owns it", async () => {
    const db = getMockDb();
    const teammate = await createTeammateOp.run(ctx({ db }), {
      name: "Nora",
      visibility: "private",
    });
    const routine = await createRoutineOp.run(ctx({ db }), {
      teammateId: teammate.id,
      instruction: "Triage feedback",
      cadence: "daily",
      hour: 8,
    });
    await expect(
      updateRoutineOp.run(
        ctx({ db, role: "viewer" as Role, userId: "u-stranger" }),
        { id: routine.id, patch: { enabled: false } }
      )
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("round-trips a disable and a delete", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });
    const routine = await createRoutineOp.run(context, {
      teammateId: teammate.id,
      instruction: "Triage feedback",
      cadence: "weekly",
      hour: 9,
    });
    expect(routine.cadence).toBe("weekly");
    expect(routine.hour).toBe(9);

    const off = await updateRoutineOp.run(context, {
      id: routine.id,
      patch: { enabled: false },
    });
    expect(off.enabled).toBe(false);

    await deleteRoutineOp.run(context, { id: routine.id });
    expect(
      await listRoutinesOp.run(context, { teammateId: teammate.id })
    ).toEqual([]);
  });
});

describe("the feedback triage template", () => {
  /** A conversation whose answer a visitor rated down. */
  async function flaggedConversation(db: Db, question: string) {
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: `visitor-${question.length}-${Math.round(question.charCodeAt(0))}`,
      title: question,
    });
    await db.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: question }],
    });
    const answer = await db.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: [{ type: "text", text: "I could not find that." }],
    });
    await db.setMessageFeedback(answer.id, -1);
    return { conversation, answer };
  }

  /**
   * The demo store ships its own rated-down conversations, so every case here
   * starts from a triaged board. Draining first makes the assertions about the
   * template's behaviour rather than about the seed data, which is free to
   * change.
   */
  async function drain(db: Db) {
    for (let pass = 0; pass < 10; pass++) {
      const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
      if (result.filed.length === 0) return;
    }
    throw new Error("triage never settled");
  }

  it("files what it found, titled with the visitor's own words", async () => {
    const db = getMockDb();
    await drain(db);
    await flaggedConversation(db, "How do I reset my password?");
    const before = (await db.listImprovements(DEMO_ORG.id)).length;

    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(result.filed).toHaveLength(1);
    // "Bad answer in conversation 8f2c" tells a reviewer nothing about whether
    // to pick it up; the visitor's question tells them everything.
    expect(result.filed[0].title).toBe("How do I reset my password?");
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before + 1);
  });

  it("labels everything it files, so the board can filter it", async () => {
    const db = getMockDb();
    await drain(db);
    await flaggedConversation(db, "Where are your offices?");
    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    const filed = await db.getImprovement(result.filed[0].id);
    expect(filed?.tags).toContain(AUTO_IMPROVEMENT_LABEL);
  });

  it("never files a second item for a problem already open", async () => {
    const db = getMockDb();
    await drain(db);
    // A question no other case in this file uses. The mock Db is a
    // process-wide singleton, and cross-conversation dedup means a title
    // another test already filed is now correctly a duplicate rather than a
    // new item, which would make this case assert the wrong thing.
    await flaggedConversation(db, "Which halls have step-free access?");

    const first = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(first.filed).toHaveLength(1);
    const dedupedBefore = first.deduped;

    // Same conversation, next night. The open item gains the evidence; the
    // board does not gain a clone.
    const second = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(second.filed).toHaveLength(0);
    expect(second.deduped).toBe(dedupedBefore + 1);
  });

  it("files one item when two conversations report the same problem", async () => {
    const db = getMockDb();
    await drain(db);
    // Two visitors, two conversations, one broken answer. The
    // conversation-scoped walk cannot see across them, which is how one bad
    // answer used to become one board item per complaint (#767, story 15).
    const baseline = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    await flaggedConversation(db, "The bursary deadline page is wrong");
    await flaggedConversation(db, "Bursary deadline page is wrong");

    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(result.filed).toHaveLength(1);
    // One more dedup than the same run made before these two arrived.
    expect(result.deduped).toBe(baseline.deduped + 1);
    // The second conversation's flagged answer is evidence on the first item,
    // so nothing is lost by not filing it.
    const links = await db.listImprovementMessages(result.filed[0].id);
    expect(links.length).toBeGreaterThan(1);
  });

  it("does not pile untitled complaints onto one item", async () => {
    const db = getMockDb();
    await drain(db);
    // No visitor question and no conversation title: the row falls back to a
    // constant, which matches itself perfectly. Two unrelated complaints must
    // still be two items.
    const first = await flaggedConversation(db, "");
    const second = await flaggedConversation(db, "");
    expect(first.conversation.id).not.toBe(second.conversation.id);

    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(result.filed).toHaveLength(2);
  });

  it("caps new items at five however much it finds", async () => {
    const db = getMockDb();
    await drain(db);
    for (let i = 0; i < 8; i++) {
      await flaggedConversation(db, `Question number ${i} about something`);
    }
    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(result.filed).toHaveLength(5);
    // The rest are reported rather than silently dropped: a run that found
    // three more problems should say so.
    expect(result.skippedForCap).toBe(3);
  });

  it("caps new items, not evidence on known ones", async () => {
    const db = getMockDb();
    await drain(db);
    // One known problem plus six new ones. The known one still gets its
    // occurrence attached even though the cap bites on the others.
    await flaggedConversation(db, "A problem we already know");
    const first = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    for (let i = 0; i < 6; i++) {
      await flaggedConversation(db, `Fresh problem ${i} reported today`);
    }
    const second = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    // The cap is on new items, which is what floods a board, not on evidence:
    // the known problem is still deduped even though five others filled it.
    expect(second.deduped).toBe(first.deduped + 1);
    expect(second.filed).toHaveLength(5);
    expect(second.skippedForCap).toBe(1);
  });

  it("files nothing on a run with no new problems", async () => {
    // The nightly no-op, and the one that runs most often. A board that grows
    // on a quiet night is a board people stop reading.
    const db = getMockDb();
    await drain(db);
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    const result = await triageFeedbackOp.run(ctx({ db: pinned(db) }), {});
    expect(result.filed).toEqual([]);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before);
  });

  it("is reachable only with the improvements grant", async () => {
    // The whole point of #770 applied here: a scheduled job files nothing
    // unless an admin said this Teammate may touch the board.
    const { teammateActions } = await import("./teammate-actions");
    expect(
      teammateActions(actor({ grants: [] })).map((s) => s.operation.name)
    ).not.toContain("improvements.triage_feedback");
    expect(
      teammateActions(actor()).map((s) => s.operation.name)
    ).toContain("improvements.triage_feedback");
    // And it writes, so a read-only ceiling keeps it out.
    expect(
      teammateActions(actor({ ceiling: "member" })).map((s) => s.operation.name)
    ).not.toContain("improvements.triage_feedback");
  });
});
