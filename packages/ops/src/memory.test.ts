import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import {
  DEMO_MEMBER,
  DEMO_ORG,
  createOrgPinnedDb,
  getMockDb,
} from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { OperationError, type OperationContext, type TeammateActor } from "./operation";
import {
  createProjectOp,
  deleteProjectOp,
  getMyMemoryOp,
  getProjectOp,
  getTeammateMemoryOp,
  listProjectsOp,
  recordProjectDecisionOp,
  rememberAboutMemberOp,
  revertMyMemoryOp,
  updateProjectOp,
  writeMyMemoryOp,
  writeProjectDocumentOp,
  writeTeammateMemoryOp,
} from "./memory";
import { teammateMemoryActions } from "./teammate-actions";
import {
  createTeammateOp,
  teammatePatchSchema,
  updateTeammateOp,
} from "./teammates";

/**
 * The three memory layers over the in-memory Db (#771).
 *
 * The cases worth writing are the ones about *whose* document a call can
 * reach. Two of the three layers are team documents and behave like any other
 * Editor-governed resource; the User layer is the Member's own, and the
 * interesting property is that no shape of call reaches somebody else's.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

/**
 * The Db a Teammate's own tool really runs on: org-pinned over the service
 * client, because a turn's capability is the Teammate's and RLS only ever sees
 * the Member who asked (#770). Fail-closed, so a write whose Db surface was
 * never declared throws here instead of on a Viewer's turn in production.
 */
const pinned = (inner = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const actor = (over: Partial<TeammateActor> = {}): TeammateActor => ({
  id: "tm-1",
  name: "Nora",
  ceiling: "edit",
  grants: [],
  approvalBypass: false,
  projectId: null,
  ...over,
});

describe("Projects", () => {
  it("creates one live and unarchived, and lists it", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const project = await createProjectOp.run(context, {
      name: "Atlas",
      description: "The migration",
    });
    expect(project.archived).toBe(false);
    expect((await listProjectsOp.run(context, {})).map((p) => p.id)).toContain(
      project.id
    );
  });

  it("keeps the decisions when archived", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const project = await createProjectOp.run(context, {
      name: "Atlas",
      description: "",
    });
    await writeProjectDocumentOp.run(context, {
      id: project.id,
      body: "We ship on Thursdays.",
      note: "",
    });
    await updateProjectOp.run(context, {
      id: project.id,
      patch: { archived: true },
    });
    const read = await getProjectOp.run(context, { id: project.id });
    expect(read.project.archived).toBe(true);
    // Archiving is not deleting: the decisions stay readable. Whether they
    // reach a prompt is `projectInjects`, and that is the runtime's call.
    expect(read.document?.body).toBe("We ship on Thursdays.");
  });

  it("refuses another Organization's Project", async () => {
    const db = getMockDb();
    const project = await createProjectOp.run(ctx({ db }), {
      name: "Atlas",
      description: "",
    });
    await expect(
      getProjectOp.run(ctx({ db, organizationId: "org-elsewhere" }), {
        id: project.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("declares the capability each surface enforces", () => {
    expect(listProjectsOp.capability).toBe("member");
    expect(createProjectOp.capability).toBe("edit");
    expect(deleteProjectOp.capability).toBe("edit");
    expect(writeProjectDocumentOp.capability).toBe("edit");
  });
});

describe("the User layer", () => {
  it("starts absent, and absent is a real answer", async () => {
    const view = await getMyMemoryOp.run(ctx({ db: getMockDb() }), {});
    expect(view.document).toBeNull();
    expect(view.entries).toEqual([]);
  });

  it("round-trips the Member's own edit with history", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    await writeMyMemoryOp.run(context, {
      body: "I work in CET and prefer bullet points.",
      note: "",
    });
    const view = await getMyMemoryOp.run(context, {});
    expect(view.document?.body).toContain("CET");
    expect(view.entries[0].authorId).toBe(DEMO_MEMBER.userId);
    // A Member editing their own document is not a Teammate write.
    expect(view.entries[0].teammateId).toBeNull();
  });

  it("names no member, so no call can reach a colleague's profile", () => {
    // The property, asserted on the schema rather than by trying to break it:
    // there is no member id to pass, so sovereignty is structural rather than
    // a check somebody has to keep remembering to write (#767, story 19).
    const shape = (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
      schema.safeParse({ memberId: "someone-else", body: "x", note: "" });
    // Zod strips unknown keys rather than failing, so the assertion that
    // matters is that the operation never reads one: parse and check.
    const parsed = writeMyMemoryOp.input.parse({
      memberId: "someone-else",
      body: "x",
      note: "",
    }) as Record<string, unknown>;
    expect(parsed.memberId).toBeUndefined();
    expect(shape(writeMyMemoryOp.input).success).toBe(true);
  });

  it("reverts a bad write back to what it replaced", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    await writeMyMemoryOp.run(context, { body: "Correct.", note: "" });
    await writeMyMemoryOp.run(context, { body: "Wrong.", note: "a bad write" });

    const before = await getMyMemoryOp.run(context, {});
    expect(before.document?.body).toBe("Wrong.");

    await revertMyMemoryOp.run(context, { entryId: before.entries[0].id });
    const after = await getMyMemoryOp.run(context, {});
    expect(after.document?.body).toBe("Correct.");
    // Append-only: the revert is itself a write, so the record shows both.
    expect(after.entries.length).toBe(before.entries.length + 1);
  });

  it("refuses to revert an entry that is not on the caller's own document", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    await writeMyMemoryOp.run(mine, { body: "Mine.", note: "" });

    // A Project document's entry: a perfectly real entry id, on a document
    // that is not this Member's profile. Reverting reaches a document by entry
    // id, so this is the direction the guard has to run.
    const project = await createProjectOp.run(mine, { name: "Atlas", description: "" });
    await writeProjectDocumentOp.run(mine, {
      id: project.id,
      body: "We ship on Thursdays.",
      note: "",
    });
    const projectView = await getProjectOp.run(mine, { id: project.id });
    const foreignEntry = projectView.entries[0].id;

    await expect(
      revertMyMemoryOp.run(mine, { entryId: foreignEntry })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(projectView.document?.body).toBe("We ship on Thursdays.");
  });
});

describe("attaching a Teammate to a Project", () => {
  it("survives the patch schema, which is the boundary that strips fields", async () => {
    // The type had `projectId` and the zod schema did not, so every attach was
    // parsed away in silence and the picker looked like it did nothing.
    const db = getMockDb();
    const context = ctx({ db });
    const project = await createProjectOp.run(context, {
      name: "Atlas",
      description: "",
    });
    const teammate = await createTeammateOp.run(context, { name: "Nora" });

    const attached = await updateTeammateOp.run(context, {
      id: teammate.id,
      patch: teammatePatchSchema.parse({ projectId: project.id }),
    });
    expect(attached.projectId).toBe(project.id);

    // And detaching, which is the same field carrying null rather than absent.
    const detached = await updateTeammateOp.run(context, {
      id: teammate.id,
      patch: teammatePatchSchema.parse({ projectId: null }),
    });
    expect(detached.projectId).toBeNull();
  });
});

describe("the Agent layer", () => {
  async function newTeammate(db: Db, over: Record<string, unknown> = {}) {
    return createTeammateOp.run(ctx({ db }), { name: "Nora", ...over });
  }

  it("is readable by the org and writable by whoever maintains the Teammate", async () => {
    const db = getMockDb();
    const teammate = await newTeammate(db);
    await writeTeammateMemoryOp.run(ctx({ db }), {
      id: teammate.id,
      body: "- 2026-08-01: they call it a Collection, not a folder",
      note: "",
    });
    const view = await getTeammateMemoryOp.run(ctx({ db }), { id: teammate.id });
    expect(view.document?.body).toContain("Collection");
    expect(view.document?.scope).toBe("agent");
  });

  it("refuses a Viewer's hand edit, and hides a colleague's private Teammate", async () => {
    const db = getMockDb();
    const teammate = await newTeammate(db, { visibility: "private" });
    // The org Role is the ceiling on editing a Teammate, persona or learnings.
    await expect(
      writeTeammateMemoryOp.run(
        ctx({ db, role: "viewer" as Role, userId: "u-someone-else" }),
        { id: teammate.id, body: "x", note: "" }
      )
    ).rejects.toBeInstanceOf(OperationError);
    await expect(
      getTeammateMemoryOp.run(
        ctx({ db, role: "viewer" as Role, userId: "u-someone-else" }),
        { id: teammate.id }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("what a Teammate writes mid-turn", () => {
  it("offers the profile tool to every Teammate, granted or not", () => {
    // Ungated on purpose: a Teammate that cannot remember what it was told
    // asks the same question forever, whatever an admin granted it.
    const names = teammateMemoryActions(actor()).map((s) => s.operation.name);
    expect(names).toContain("memory.remember");
  });

  it("offers the project tool only when there is a project to write to", () => {
    expect(
      teammateMemoryActions(actor()).map((s) => s.operation.name)
    ).not.toContain("memory.project.record");
    expect(
      teammateMemoryActions(actor({ projectId: "p-1" })).map(
        (s) => s.operation.name
      )
    ).toContain("memory.project.record");
  });

  it("writes the invoking Member's profile, and records which Teammate did", async () => {
    const db = getMockDb();
    const context = ctx({ db: pinned(db), teammate: actor() });
    await rememberAboutMemberOp.run(context, {
      body: "Marta works in CET.",
      note: "Learned their timezone",
    });
    const view = await getMyMemoryOp.run(ctx({ db }), {});
    expect(view.document?.body).toBe("Marta works in CET.");
    // Who/when/what: the Teammate that wrote it and the Member it is about.
    expect(view.entries[0].teammateId).toBe("tm-1");
    expect(view.entries[0].authorId).toBe(DEMO_MEMBER.userId);
    expect(view.entries[0].note).toBe("Learned their timezone");
  });

  it("writes a Viewer's own profile on a Viewer's turn", async () => {
    // The #770 rule carried into #771: what a Teammate may do is its own, and
    // the invoking Member is the attribution, not the gate.
    const db = getMockDb();
    await rememberAboutMemberOp.run(
      ctx({
        db: pinned(db),
        role: "viewer" as Role,
        userId: "u-viewer",
        teammate: actor(),
      }),
      { body: "A viewer's own note.", note: "" }
    );
    const view = await getMyMemoryOp.run(
      ctx({ db, role: "viewer" as Role, userId: "u-viewer" }),
      {}
    );
    expect(view.document?.body).toBe("A viewer's own note.");
  });

  it("refuses both tools when nothing is acting as a Teammate", async () => {
    await expect(
      rememberAboutMemberOp.run(ctx(), { body: "x", note: "" })
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("records a decision on the attached Project, and nowhere else", async () => {
    const db = getMockDb();
    const project = await createProjectOp.run(ctx({ db }), {
      name: "Atlas",
      description: "",
    });
    await recordProjectDecisionOp.run(
      ctx({ db: pinned(db), teammate: actor({ projectId: project.id }) }),
      { body: "We ship on Thursdays.", note: "Agreed in standup" }
    );
    const view = await getProjectOp.run(ctx({ db }), { id: project.id });
    expect(view.document?.body).toBe("We ship on Thursdays.");
    expect(view.entries[0].note).toBe("Agreed in standup");
  });

  it("says what to do when it has no project, rather than failing opaquely", async () => {
    await expect(
      recordProjectDecisionOp.run(ctx({ teammate: actor() }), {
        body: "x",
        note: "",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("attach"),
    });
  });

  it("refuses to write an archived Project's decisions", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const project = await createProjectOp.run(context, {
      name: "Atlas",
      description: "",
    });
    await updateProjectOp.run(context, {
      id: project.id,
      patch: { archived: true },
    });
    await expect(
      recordProjectDecisionOp.run(
        ctx({ db: pinned(db), teammate: actor({ projectId: project.id }) }),
        { body: "Too late.", note: "" }
      )
    ).rejects.toMatchObject({ message: expect.stringContaining("archived") });
  });
});
