import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import {
  DEMO_MEMBER,
  DEMO_ORG,
  danglingScopeAlertKey,
  getMockDb,
  raiseDanglingCollectionAlert,
} from "@agent-hub/db";
import {
  createTeammateOp,
  hideTeammateOp,
  unhideTeammateOp,
  deleteTeammateOp,
  getTeammateOp,
  listTeammateThreadOp,
  listTeammatesOp,
  readTeammateConversationOp,
  updateTeammateOp,
} from "./teammates";
import { OperationError, type OperationContext } from "./operation";

/**
 * The Teammates domain (#768) over the in-memory Db. Behaviour only: what an
 * operation returns and what the next read sees.
 *
 * The cases that matter are the refusals. A Teammate can be private, can be
 * edited by people who do not own it, and outlives its own deletion, so the
 * ways it can leak or be changed by the wrong colleague are the interesting
 * half of the surface.
 */

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

const create = (over: Record<string, unknown> = {}, context = ctx()) =>
  createTeammateOp.run(context, {
    name: "Nora",
    title: "Support Copywriter",
    roleDescription: "You draft replies from our docs.",
    ...over,
  });

describe("teammates operations", () => {
  it("declares the catalogue contract: capability + mutated entities", () => {
    expect(listTeammatesOp.capability).toBe("member");
    expect(getTeammateOp.capability).toBe("member");
    expect(createTeammateOp.capability).toBe("edit");
    expect(updateTeammateOp.capability).toBe("edit");
    expect(deleteTeammateOp.capability).toBe("edit");
    expect(createTeammateOp.entities({ name: "x" }, undefined as never)).toEqual([
      { kind: "teammateList" },
    ]);
    expect(
      updateTeammateOp.entities({ id: "tm1", patch: {} }, undefined as never)
    ).toEqual([{ kind: "teammate", id: "tm1" }, { kind: "teammateList" }]);
  });

  it("creates from a name and stamps the caller as owner", async () => {
    const created = await create({ title: "", roleDescription: "" });
    expect(created.organizationId).toBe(DEMO_ORG.id);
    expect(created.ownerId).toBe(DEMO_MEMBER.userId);
    expect(created.visibility).toBe("org");
    expect(created.collectionIds).toEqual([]);
    expect(created.deletedAt).toBeNull();
  });

  it("edits the standing role with no republish step in between", async () => {
    const created = await create();
    const updated = await updateTeammateOp.run(ctx(), {
      id: created.id,
      patch: { roleDescription: "You write release notes." },
    });
    expect(updated.roleDescription).toBe("You write release notes.");
    // The next read is the next turn's config: nothing was frozen anywhere.
    const reread = await getTeammateOp.run(ctx(), { id: created.id });
    expect(reread.roleDescription).toBe("You write release notes.");
  });

  it("keeps a private Teammate off a colleague's roster but not off an admin's", async () => {
    const mine = await create({ name: "Private", visibility: "private" });
    await create({ name: "Shared" });

    const colleague = ctx({ userId: "another-member", role: "editor" });
    const names = (await listTeammatesOp.run(colleague, {})).map((t) => t.name);
    expect(names).toContain("Shared");
    expect(names).not.toContain("Private");

    const admin = ctx({ userId: "another-member", role: "admin" });
    expect((await listTeammatesOp.run(admin, {})).map((t) => t.id)).toContain(
      mine.id
    );
  });

  it("refuses to read a private Teammate the caller may not see", async () => {
    const mine = await create({ visibility: "private" });
    const colleague = ctx({ userId: "another-member", role: "editor" });
    await expect(getTeammateOp.run(colleague, { id: mine.id })).rejects.toThrow(
      OperationError
    );
  });

  it("refuses an edit from an Editor who neither owns it nor is named on it", async () => {
    const mine = await create();
    const stranger = ctx({ userId: "another-member", role: "editor" });
    await expect(
      updateTeammateOp.run(stranger, { id: mine.id, patch: { name: "Theirs" } })
    ).rejects.toThrow(OperationError);

    // Naming them changes the answer, and only for them.
    await updateTeammateOp.run(ctx(), {
      id: mine.id,
      patch: { editorIds: ["another-member"] },
    });
    const updated = await updateTeammateOp.run(stranger, {
      id: mine.id,
      patch: { title: "Co-maintained" },
    });
    expect(updated.title).toBe("Co-maintained");
  });

  it("refuses every write from another Organization", async () => {
    const mine = await create();
    const foreign = ctx({ organizationId: "some-other-org", role: "admin" });
    await expect(getTeammateOp.run(foreign, { id: mine.id })).rejects.toThrow(
      OperationError
    );
    await expect(
      updateTeammateOp.run(foreign, { id: mine.id, patch: { name: "Taken" } })
    ).rejects.toThrow(OperationError);
    await expect(deleteTeammateOp.run(foreign, { id: mine.id })).rejects.toThrow(
      OperationError
    );
  });

  it("soft-deletes: off every roster, past Conversations still readable", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await create({ name: "Retired" }, context);
    const conversation = await db.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "what we discussed",
    });
    await db.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "so what did we agree?" }],
    });

    await deleteTeammateOp.run(context, { id: teammate.id });

    // Off the roster: a card nobody can chat with is a dead end.
    expect(
      (await listTeammatesOp.run(context, {})).map((t) => t.id)
    ).not.toContain(teammate.id);

    // Still readable, which is the whole point of a tombstone (#767, story 33).
    // The Teammate's own thread is the only place these Conversations live, so
    // a rule that hid the row would take the transcripts with it.
    const stored = await getTeammateOp.run(context, { id: teammate.id });
    expect(stored.deletedAt).toBeTruthy();
    expect(
      (await listTeammateThreadOp.run(context, { id: teammate.id })).map(
        (c) => c.id
      )
    ).toEqual([conversation.id]);
    const read = await readTeammateConversationOp.run(context, {
      id: teammate.id,
      conversationId: conversation.id,
    });
    expect(read.conversation.title).toBe("what we discussed");
    expect(read.messages).toHaveLength(1);

    // Readable is not writable: nothing about it can change again.
    await expect(
      updateTeammateOp.run(context, {
        id: teammate.id,
        patch: { name: "Back from the dead" },
      })
    ).rejects.toThrow(OperationError);
  });

  it("returns this Member's own thread with a Teammate, nobody else's", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await create({ name: "Threaded" }, context);
    const mine = await db.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "mine",
    });
    await db.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: "another-member",
      title: "theirs",
    });

    const thread = await listTeammateThreadOp.run(context, { id: teammate.id });
    expect(thread.map((c) => c.id)).toEqual([mine.id]);
  });

  it("reads back one of its own past conversations, and nobody else's", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await create({ name: "Readable" }, context);
    const conversation = await db.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "kept",
    });
    await db.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "what did we decide?" }],
    });

    const read = await readTeammateConversationOp.run(context, {
      id: teammate.id,
      conversationId: conversation.id,
    });
    expect(read.conversation.title).toBe("kept");
    expect(read.messages).toHaveLength(1);

    // Another Member's thread with the same Teammate is not readable here.
    const colleague = ctx({ db, userId: "another-member" });
    await expect(
      readTeammateConversationOp.run(colleague, {
        id: teammate.id,
        conversationId: conversation.id,
      })
    ).rejects.toThrow(OperationError);
  });

  it("clears the dangling-Collection Alert when the scope drops the id", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await create({ collectionIds: ["col-vanished"] }, context);
    await raiseDanglingCollectionAlert(
      db,
      DEMO_ORG.id,
      "col-vanished",
      "Refunds"
    );
    const active = async () =>
      (await db.listAlerts(DEMO_ORG.id))
        .filter((alert) => alert.status === "active")
        .map((alert) => alert.sourceKey);
    expect(await active()).toContain(danglingScopeAlertKey("col-vanished"));

    await updateTeammateOp.run(context, {
      id: teammate.id,
      patch: { collectionIds: [] },
    });

    expect(await active()).not.toContain(danglingScopeAlertKey("col-vanished"));
  });

  it("clears it on retirement too: a retired Teammate searches nothing", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const teammate = await create({ collectionIds: ["col-retired-ref"] }, context);
    await raiseDanglingCollectionAlert(
      db,
      DEMO_ORG.id,
      "col-retired-ref",
      "Refunds"
    );

    await deleteTeammateOp.run(context, { id: teammate.id });

    const active = (await db.listAlerts(DEMO_ORG.id))
      .filter((alert) => alert.status === "active")
      .map((alert) => alert.sourceKey);
    expect(active).not.toContain(danglingScopeAlertKey("col-retired-ref"));
  });

  it("raises the Alert when a scope names a Collection that is already gone", async () => {
    // The delete path is the common way a scope goes stale, not the only one:
    // a Member can type an id, or paste a scope from somewhere older.
    const db = getMockDb();
    const context = ctx({ db });
    await create({ collectionIds: ["col-never-existed"] }, context);

    const active = (await db.listAlerts(DEMO_ORG.id))
      .filter((alert) => alert.status === "active")
      .map((alert) => alert.sourceKey);
    expect(active).toContain(danglingScopeAlertKey("col-never-existed"));
  });

  it("stays quiet when the scope names a Collection that exists", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const assistant = (await db.listAssistants(DEMO_ORG.id))[0];
    const collection = await db.createCollection(assistant.id, {
      name: "Live one",
    });
    await create({ collectionIds: [collection.id] }, context);

    const active = (await db.listAlerts(DEMO_ORG.id))
      .filter((alert) => alert.status === "active")
      .map((alert) => alert.sourceKey);
    expect(active).not.toContain(danglingScopeAlertKey(collection.id));
  });

  it("rejects a scope that is not a list of Collection ids", async () => {
    await expect(
      createTeammateOp.input.parseAsync({ name: "Nora", collectionIds: "col-1" })
    ).rejects.toThrow();
    await expect(
      createTeammateOp.input.parseAsync({ name: "" })
    ).rejects.toThrow();
  });
});

describe("hiding a Teammate from your own roster (#767, story 10)", () => {
  it("records the choice against the Member, and nobody else", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    const noisy = await create({ name: "Noisy" }, mine);

    await hideTeammateOp.run(mine, { id: noisy.id });

    const rows = await db
      .table("teammateRosterHidden")
      .list({ teammateId: noisy.id });
    expect(rows.map((row) => row.userId)).toEqual([DEMO_MEMBER.userId]);
    // The Teammate is untouched: hiding is a fact about one roster.
    expect((await getTeammateOp.run(mine, { id: noisy.id })).deletedAt).toBeNull();
  });

  it("does not narrow teammates.list, which is also the API and the CLI", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    const noisy = await create({ name: "Machine visible" }, mine);
    await hideTeammateOp.run(mine, { id: noisy.id });
    // The roster is drawn by the console over `rosterTeammates`; this operation
    // answers "what may this caller see", and an API key carries its creator's
    // user id, so filtering here would drop rows from a machine contract.
    expect((await listTeammatesOp.run(mine, {})).map((t) => t.name)).toContain(
      "Machine visible"
    );
  });

  it("still opens by id, because hiding is not disabling", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    const teammate = await create({ name: "Hidden but alive" }, mine);
    await hideTeammateOp.run(mine, { id: teammate.id });
    // The chat route goes through the visibility rule, not the roster, so a
    // hidden Teammate a Member opens deliberately still answers.
    await expect(
      getTeammateOp.run(mine, { id: teammate.id })
    ).resolves.toMatchObject({ id: teammate.id });
  });

  it("unhiding puts it back, so the choice is reversible", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    const teammate = await create({ name: "Findable again" }, mine);
    await hideTeammateOp.run(mine, { id: teammate.id });
    await unhideTeammateOp.run(mine, { id: teammate.id });
    // Unhiding is a delete: no row is left saying "not hidden".
    expect(
      await db.table("teammateRosterHidden").list({ teammateId: teammate.id })
    ).toEqual([]);
  });

  it("refuses an API-key caller, which has no roster of its own", async () => {
    const db = getMockDb();
    const teammate = await create({ name: "Machine" }, ctx({ db }));
    // `userId` is the empty string for a key; writing that into a uuid column
    // is a database error where a refusal belongs.
    await expect(
      hideTeammateOp.run(ctx({ db, userId: "" }), { id: teammate.id })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("hiding twice is hiding, not an error", async () => {
    const db = getMockDb();
    const mine = ctx({ db });
    const teammate = await create({ name: "Twice" }, mine);
    await hideTeammateOp.run(mine, { id: teammate.id });
    await expect(hideTeammateOp.run(mine, { id: teammate.id })).resolves.toBeUndefined();
    expect(
      await db.table("teammateRosterHidden").list({ teammateId: teammate.id })
    ).toHaveLength(1);
  });

  it("refuses to hide a Teammate this Member cannot see", async () => {
    const db = getMockDb();
    const secret = await create({ name: "Secret", visibility: "private" }, ctx({ db }));
    // Otherwise any id from anywhere writes a row, and the refusal is the
    // usual not_found so the attempt learns nothing.
    await expect(
      hideTeammateOp.run(ctx({ db, userId: "stranger", role: "viewer" }), {
        id: secret.id,
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("declares the catalogue contract: a Member right, and it mutates the roster", () => {
    expect(hideTeammateOp.capability).toBe("member");
    expect(unhideTeammateOp.capability).toBe("member");
    expect(hideTeammateOp.entities({ id: "tm1" }, undefined as never)).toEqual([
      { kind: "teammateList" },
    ]);
  });
});
