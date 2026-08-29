import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { type OperationContext } from "./operation";
import { createTeammateOp, startReferralOp } from "./teammates";

/**
 * Accepting a Teammate referral (#773): what the click does.
 *
 * The card itself is the runtime's business and the candidate filter is the
 * domain package's; this is the operation behind the link, so the cases are
 * about the two conversations it touches and the four ways the target can turn
 * out to be one this Member may not open.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

describe("accepting a referral", () => {
  /** An origin conversation this Member had with one Teammate. */
  async function origin(db: Db) {
    const context = ctx({ db });
    const from = await createTeammateOp.run(context, { name: "Nora" });
    const to = await createTeammateOp.run(context, { name: "Ada" });
    const conversation = await db.createConversation({
      teammateId: from.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "a chat",
    });
    return { from, to, conversation };
  }

  it("opens the target's chat carrying the summary as context, not as a message", async () => {
    const db = getMockDb();
    const { from, to, conversation } = await origin(db);

    const { conversationId } = await startReferralOp.run(ctx({ db }), {
      originConversationId: conversation.id,
      teammateId: to.id,
      summary: "They want last quarter's retention split by plan.",
    });

    const opened = await db.getConversation(conversationId);
    expect(opened?.teammateId).toBe(to.id);
    expect(opened?.metadata.referralSummary).toContain("retention");
    expect(opened?.metadata.referredFromTeammateName).toBe(from.name);
    expect(opened?.metadata.referredFromConversationId).toBe(conversation.id);
    // Carried as metadata, never appended as a message: it is neither the
    // Member's words nor the target's, and faking it into the transcript is a
    // lie the target would quote back.
    expect(await db.listMessages(conversationId)).toEqual([]);
  });

  it("makes the origin point forward, so the handoff is a link", async () => {
    const db = getMockDb();
    const { to, conversation } = await origin(db);
    const { conversationId } = await startReferralOp.run(ctx({ db }), {
      originConversationId: conversation.id,
      teammateId: to.id,
      summary: "s",
    });
    const after = await db.getConversation(conversation.id);
    expect(after?.metadata.referredTo).toEqual([
      { conversationId, teammateId: to.id, teammateName: "Ada" },
    ]);
  });

  it("refuses an origin that is not this Member's own conversation", async () => {
    const db = getMockDb();
    const { to, conversation } = await origin(db);
    // A forged origin id would otherwise write a referral onto somebody else's
    // transcript.
    await expect(
      startReferralOp.run(ctx({ db, userId: "u-someone-else" }), {
        originConversationId: conversation.id,
        teammateId: to.id,
        summary: "s",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a target this Member cannot see", async () => {
    const db = getMockDb();
    const { conversation } = await origin(db);
    const secret = await createTeammateOp.run(ctx({ db }), {
      name: "Secret",
      visibility: "private",
    });
    // The tool only ever offers org-visible candidates; this is the check that
    // holds if that filter ever slips.
    await expect(
      startReferralOp.run(
        ctx({ db, userId: "u-stranger", role: "viewer" as Role }),
        {
          originConversationId: conversation.id,
          teammateId: secret.id,
          summary: "s",
        }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a target that was deleted between the card and the click", async () => {
    const db = getMockDb();
    const { to, conversation } = await origin(db);
    await db.table("teammates").update(to.id, {
      deletedAt: new Date().toISOString(),
    });
    await expect(
      startReferralOp.run(ctx({ db }), {
        originConversationId: conversation.id,
        teammateId: to.id,
        summary: "s",
      })
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
