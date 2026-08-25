import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import {
  OperationError,
  type OperationContext,
  type TeammateActor,
} from "./operation";
import {
  TEAMMATE_ACTION_CATALOG,
  runTeammateAction,
  teammateActions,
} from "./teammate-actions";
import {
  listTeammateGrantsOp,
  setTeammateGrantsOp,
} from "./teammate-grants";
import { createTeammateOp } from "./teammates";
import { acceptSuggestedFixOp, proposeSuggestedFixOp } from "./improvements";
import { createOrgFaqOp } from "./knowledge";

/**
 * What an AI Teammate may do (#770), over the in-memory Db.
 *
 * The interesting assertions are all refusals, and they come in three flavours
 * the code treats differently on purpose: an ungranted domain (no tool at all),
 * a capability over the ceiling (tool absent for that operation only), and the
 * approval-bypass gate (present for one Teammate, absent for its neighbour).
 *
 * Behaviour only: what the catalogue offers, what a run returns, and what the
 * next read sees. Never which method the operation called to get there.
 */

const actor = (over: Partial<TeammateActor> = {}): TeammateActor => ({
  id: "tm-1",
  name: "Nora",
  ceiling: "edit",
  grants: [],
  approvalBypass: false,
  ...over,
});

/**
 * The Db a Teammate action really runs on: org-pinned over the service client,
 * not the caller's RLS-scoped session (see the note in the module under test).
 * Using it here is the point, the wrapper is fail-closed, so an operation whose
 * Db surface was never declared throws `not_exposed` in this suite instead of
 * in production on a Viewer's turn.
 */
const pinned = (inner = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: pinned(),
  ...over,
});

const names = (specs: { operation: { name: string } }[]) =>
  specs.map((spec) => spec.operation.name);

describe("the action catalogue", () => {
  it("offers nothing to a Teammate nobody granted anything", () => {
    // The normal state of a freshly created Teammate: it talks, and that is all.
    expect(teammateActions(actor())).toEqual([]);
  });

  it("offers one domain's actions per grant row, and no neighbour's", () => {
    const offered = names(teammateActions(actor({ grants: ["improvements"] })));
    expect(offered).toContain("improvements.update");
    expect(offered.every((name) => name.startsWith("improvements."))).toBe(true);
  });

  it("caps a granted domain at the ceiling", () => {
    const reading = names(
      teammateActions(actor({ grants: ["improvements"], ceiling: "member" }))
    );
    // The reads survive; the writes do not. Same grant row, different ceiling.
    expect(reading).toContain("improvements.list");
    expect(reading).toContain("improvements.get");
    expect(reading).not.toContain("improvements.update");
    expect(reading).not.toContain("improvements.fix.propose");
  });

  it("never offers a destructive operation, at any ceiling", () => {
    const everything = names(
      teammateActions(
        actor({
          grants: ["improvements", "knowledge", "inbox"],
          ceiling: "publish",
          approvalBypass: true,
        })
      )
    );
    // `inbox.conversations.delete` declares `capability: "member"` on purpose
    // (API-key parity), so nothing about the ceiling keeps it out. Only its
    // absence from the catalogue does.
    expect(everything).not.toContain("inbox.conversations.delete");
    expect(everything).not.toContain("knowledge.sources.delete");
    expect(everything).not.toContain("knowledge.sources.unlink");
  });

  it("gives the knowledge grant the assistant read its writes need", () => {
    // `knowledge.collections.list` and `knowledge.org.faqs.create` both take an
    // Assistant id. Without `assistants.list` the grant buys a domain the
    // Teammate cannot use, because it has no way to learn one.
    const offered = names(teammateActions(actor({ grants: ["knowledge"] })));
    expect(offered).toContain("assistants.list");
    expect(offered).toContain("knowledge.org.faqs.create");
    // And it is the knowledge grant that buys it, not a free-floating read.
    expect(names(teammateActions(actor({ grants: ["inbox"] })))).not.toContain(
      "assistants.list"
    );
  });

  it("declares no operation a Teammate could never reach", () => {
    // Every catalogued operation must be reachable at some ceiling, or it is
    // dead weight the model still has to read past.
    for (const specs of Object.values(TEAMMATE_ACTION_CATALOG)) {
      for (const spec of specs) {
        expect(["member", "edit", "publish"]).toContain(
          spec.operation.capability
        );
      }
    }
  });

  it("gates accept on the bypass and the knowledge grant together", () => {
    const withBoth = names(
      teammateActions(
        actor({ grants: ["improvements", "knowledge"], approvalBypass: true })
      )
    );
    expect(withBoth).toContain("improvements.fix.accept");

    // Bypass but no knowledge grant: accepting writes a Concept, and it was
    // never granted the domain that writes Concepts.
    expect(
      names(teammateActions(actor({ grants: ["improvements"], approvalBypass: true })))
    ).not.toContain("improvements.fix.accept");

    // Knowledge grant but no bypass: the ordinary trusted Teammate. It drafts,
    // a colleague accepts.
    const drafterOnly = names(
      teammateActions(actor({ grants: ["improvements", "knowledge"] }))
    );
    expect(drafterOnly).toContain("improvements.fix.propose");
    expect(drafterOnly).not.toContain("improvements.fix.accept");
  });
});

describe("runTeammateAction", () => {
  it("refuses an ungranted operation with a sentence the model can use", async () => {
    const context = ctx({ teammate: actor({ grants: ["knowledge"] }) });
    await expect(
      runTeammateAction(context, "improvements.update", { id: "x", patch: {} })
    ).rejects.toMatchObject({
      name: "OperationError",
      message: expect.stringContaining("administrator"),
    });
  });

  it("refuses an operation over the ceiling even when its domain is granted", async () => {
    const context = ctx({
      teammate: actor({ grants: ["improvements"], ceiling: "member" }),
    });
    await expect(
      runTeammateAction(context, "improvements.update", { id: "x", patch: {} })
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("refuses to run at all without a Teammate on the context", async () => {
    await expect(
      runTeammateAction(ctx(), "improvements.list", {})
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("returns the operation's own mutated-entity declaration for the card", async () => {
    const db = getMockDb();
    const improvements = await db.listImprovements(DEMO_ORG.id);
    const target = improvements[0];
    expect(target).toBeDefined();

    const outcome = await runTeammateAction(
      ctx({ db: pinned(db), teammate: actor({ grants: ["improvements"] }) }),
      "improvements.update",
      { id: target.id, patch: { status: "in_progress" } }
    );
    expect(outcome.operation).toBe("improvements.update");
    expect(outcome.domain).toBe("improvements");
    // The card names the entity because the operation already declared it; the
    // catalogue does not maintain a second, drift-prone copy.
    expect(outcome.entities).toContainEqual({
      kind: "improvement",
      id: target.id,
    });
  });

  it("mutates on a Viewer's turn, and records the Viewer who asked", async () => {
    // The point of the whole model: capability is the Teammate's, attribution
    // is the Member's. A Viewer cannot move this item themselves.
    const db = getMockDb();
    const target = (await db.listImprovements(DEMO_ORG.id))[0];
    const outcome = await runTeammateAction(
      ctx({
        db: pinned(db),
        role: "viewer" as Role,
        userId: "u-viewer",
        teammate: actor({ grants: ["improvements"] }),
      }),
      "improvements.update",
      { id: target.id, patch: { status: "done" } }
    );
    expect((outcome.result as { status: string }).status).toBe("done");
    expect((await db.getImprovement(target.id))?.status).toBe("done");
  });
});

describe("Suggested Fixes", () => {
  /**
   * An Improvement with a flagged assistant answer behind it: the shape a fix
   * needs, built here rather than hunted for in the demo store so the cases do
   * not silently change meaning when the seed data does.
   */
  async function improvementWithFlaggedAnswer(db: Db) {
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const collection = await db.createCollection(assistant.id, {
      name: "Account help",
    });
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "visitor-fix-case",
      collectionId: collection.id,
      title: "password reset",
    });
    await db.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "How do I reset my password?" }],
    });
    const answer = await db.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: [{ type: "text", text: "I could not find that." }],
    });
    return db.createImprovement(DEMO_ORG.id, {
      title: "Password reset answer is wrong",
      createdBy: DEMO_MEMBER.userId,
      messageId: answer.id,
    });
  }

  it("drafts a fix from chat and leaves it awaiting review", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const outcome = await runTeammateAction(
      ctx({ db: pinned(db), teammate: actor({ grants: ["improvements"] }) }),
      "improvements.fix.propose",
      {
        improvementId: improvement.id,
        question: "How do I reset my password?",
        answer: "Open Settings, choose Security, then Reset password.",
        rationale: "The flagged answer sent them to a page that no longer exists.",
      }
    );
    const proposal = outcome.result as { status: string; payload: { model: string } };
    expect(proposal.status).toBe("draft");
    // Attribution: the draft records the Teammate that wrote it, not "member".
    expect(proposal.payload.model).toBe("teammate/Nora");
    expect((await db.getImprovementProposal(improvement.id))?.status).toBe("draft");
  });

  it("refuses a second draft while one is awaiting review", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const context = ctx({ db: pinned(db), teammate: actor({ grants: ["improvements"] }) });
    const draft = {
      improvementId: improvement.id,
      question: "How do I reset my password?",
      answer: "Open Settings, choose Security, then Reset password.",
      rationale: "",
    };
    await runTeammateAction(context, "improvements.fix.propose", draft);
    await expect(
      runTeammateAction(context, "improvements.fix.propose", draft)
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to draft against an Improvement with no flagged answer", async () => {
    const db = getMockDb();
    const bare = await db.createImprovement(DEMO_ORG.id, {
      title: "Someone typed this in by hand",
      createdBy: DEMO_MEMBER.userId,
    });
    await expect(
      runTeammateAction(
        ctx({ db: pinned(db), teammate: actor({ grants: ["improvements"] }) }),
        "improvements.fix.propose",
        {
          improvementId: bare.id,
          question: "q",
          answer: "a",
          rationale: "",
        }
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses the accept a Teammate has no bypass for", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const context = ctx({ db: pinned(db), teammate: actor({ grants: ["improvements"] }) });
    await runTeammateAction(context, "improvements.fix.propose", {
      improvementId: improvement.id,
      question: "q",
      answer: "a",
      rationale: "",
    });

    // Straight at the operation, past the catalogue that would not have offered
    // it: the gate has to hold at the operation too, or a registration bug is a
    // capability.
    await expect(
      acceptSuggestedFixOp.run(context, { improvementId: improvement.id })
    ).rejects.toMatchObject({
      message: expect.stringContaining("colleague"),
    });
    expect((await db.getImprovementProposal(improvement.id))?.status).toBe("draft");
  });

  it("writes the FAQ Concept when the admin granted the bypass", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const written: { question: string; verified: unknown }[] = [];
    const context = ctx({
      db: pinned(db),
      teammate: actor({
        grants: ["improvements", "knowledge"],
        approvalBypass: true,
      }),
      ports: {
        persistFaq: async (args) => {
          written.push({
            question: args.question,
            verified: args.provenance.verified,
          });
          return { id: "concept-written" } as never;
        },
      },
    });
    await runTeammateAction(context, "improvements.fix.propose", {
      improvementId: improvement.id,
      question: "How do I reset my password?",
      answer: "Open Settings, choose Security, then Reset password.",
      rationale: "",
    });
    const outcome = await runTeammateAction(context, "improvements.fix.accept", {
      improvementId: improvement.id,
    });

    expect((outcome.result as { conceptId: string }).conceptId).toBe(
      "concept-written"
    );
    expect(written).toHaveLength(1);
    expect(written[0].question).toBe("How do I reset my password?");
    // The load-bearing half of the ADR amendment: a bypassing Teammate signs as
    // an agent, so the Concept lands `machine-confirmed`. The bypass moves who
    // may press accept; it does not let a machine sign as a person.
    expect(written[0].verified).toEqual([
      { by: "teammate/Nora", at: expect.any(String) },
    ]);

    const proposal = await db.getImprovementProposal(improvement.id);
    expect(proposal?.status).toBe("accepted");
    expect((await db.getImprovement(improvement.id))?.status).toBe("in_review");
  });

  it("stamps a human actor when a Member accepts, so the tier is human-reviewed", async () => {
    const db = getMockDb();
    const improvement = await improvementWithFlaggedAnswer(db);
    const written: unknown[] = [];
    // No `teammate` on the context: this is the console button.
    const context = ctx({
      db: pinned(db),
      ports: {
        persistFaq: async (args) => {
          written.push(args.provenance.verified);
          return { id: "concept-human" } as never;
        },
      },
    });
    await proposeSuggestedFixOp.run(context, {
      improvementId: improvement.id,
      question: "q",
      answer: "a",
      rationale: "",
    });
    await acceptSuggestedFixOp.run(context, { improvementId: improvement.id });
    expect(written).toEqual([
      [{ by: `human:${DEMO_MEMBER.userId}`, at: expect.any(String) }],
    ]);
  });
});

describe("provenance", () => {
  /**
   * The rule the ADR-0017 amendment turns on, applied to the *other* knowledge
   * write a Teammate can reach. Accepting a fix is the famous one; adding a FAQ
   * from chat is the quiet one, and it used to stamp `human:<memberId>` because
   * every caller of that operation was a person until now.
   */
  it("signs a Teammate-written FAQ as an agent, not as the Member who asked", async () => {
    const db = getMockDb();
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const written: string[] = [];
    const context = ctx({
      db: pinned(db),
      teammate: actor({ grants: ["knowledge"] }),
      ports: {
        persistFaq: async (args) => {
          written.push(args.provenance.generated?.by ?? "");
          return { id: "concept-1" } as never;
        },
      },
    });

    await runTeammateAction(context, "knowledge.org.faqs.create", {
      assistantIds: [assistant.id],
      question: "What are your opening hours?",
      answer: "Nine to five, Monday to Friday.",
    });
    expect(written).toEqual(["teammate/Nora"]);
    // Not the invoking Member, whatever else is true: a person's name on
    // content a model wrote is a false record, even though `generated` alone
    // does not move the OKF trust tier.
    expect(written[0]).not.toContain(DEMO_MEMBER.userId);
    expect(written[0]).not.toMatch(/^human:/);
  });

  it("still signs a Member's own FAQ as that Member", async () => {
    const db = getMockDb();
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const written: string[] = [];
    // No `teammate` on the context: the console form, unchanged.
    await createOrgFaqOp.run(
      ctx({
        db: pinned(db),
        ports: {
          persistFaq: async (args) => {
            written.push(args.provenance.generated?.by ?? "");
            return { id: "concept-2" } as never;
          },
        },
      }),
      {
        assistantIds: [assistant.id],
        question: "What are your opening hours?",
        answer: "Nine to five, Monday to Friday.",
      }
    );
    expect(written).toEqual([`human:${DEMO_MEMBER.userId}`]);
  });
});

describe("granting", () => {
  it("is admin work, one rung above editing the Teammate", () => {
    expect(setTeammateGrantsOp.capability).toBe("manageMembers");
    expect(listTeammateGrantsOp.capability).toBe("member");
  });

  it("replaces the whole set, and revoking removes the row", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });

    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["improvements", "inbox"],
    });
    expect(
      (await listTeammateGrantsOp.run(context, { id: teammate.id })).domains
    ).toEqual(["improvements", "inbox"]);

    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["improvements"],
    });
    const after = await listTeammateGrantsOp.run(context, { id: teammate.id });
    expect(after.domains).toEqual(["improvements"]);
    // Revoked, not disabled: the row is gone.
    expect(await db.table("teammateGrants").list({ teammateId: teammate.id }))
      .toHaveLength(1);
  });

  it("re-granting a held domain does not duplicate the row", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });
    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["knowledge"],
    });
    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["knowledge", "inbox"],
    });
    const rows = await db.table("teammateGrants").list({ teammateId: teammate.id });
    expect(rows.map((row) => row.domain).sort()).toEqual(["inbox", "knowledge"]);
  });

  it("carries the ceiling and the bypass, and leaves unnamed ones alone", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });
    expect(teammate.capabilityCeiling).toBe("edit");
    expect(teammate.approvalBypass).toBe(false);

    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["knowledge"],
      approvalBypass: true,
    });
    let state = await listTeammateGrantsOp.run(context, { id: teammate.id });
    expect(state.approvalBypass).toBe(true);
    expect(state.ceiling).toBe("edit");

    await setTeammateGrantsOp.run(context, {
      id: teammate.id,
      domains: ["knowledge"],
      ceiling: "member",
    });
    state = await listTeammateGrantsOp.run(context, { id: teammate.id });
    expect(state.ceiling).toBe("member");
    expect(state.approvalBypass).toBe(true);
  });

  it("refuses a Teammate from another Organization", async () => {
    const db = getMockDb();
    const teammate = await createTeammateOp.run(ctx({ db }), { name: "Nora" });
    await expect(
      listTeammateGrantsOp.run(
        ctx({ db, organizationId: "org-somewhere-else" }),
        { id: teammate.id }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("will not confirm a private Teammate to a colleague who cannot see it", async () => {
    const db = getMockDb();
    const owner = ctx({ db });
    const teammate = await createTeammateOp.run(owner, {
      name: "Nora",
      visibility: "private",
    });
    await setTeammateGrantsOp.run(owner, {
      id: teammate.id,
      domains: ["improvements"],
    });

    // Holding the id is not seeing the Teammate. Reading grants is a Member
    // right over the roster they have, and a private Teammate is not on it:
    // answering here would disclose both that it exists and what it may do.
    await expect(
      listTeammateGrantsOp.run(
        ctx({ db, userId: "another-member", role: "editor" }),
        { id: teammate.id }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("still reads an org-visible Teammate's grants for any Member", async () => {
    const db = getMockDb();
    const owner = ctx({ db });
    const teammate = await createTeammateOp.run(owner, { name: "Shared" });
    await setTeammateGrantsOp.run(owner, {
      id: teammate.id,
      domains: ["inbox"],
    });
    const seen = await listTeammateGrantsOp.run(
      ctx({ db, userId: "another-member", role: "viewer" }),
      { id: teammate.id }
    );
    expect(seen.domains).toEqual(["inbox"]);
  });
});
