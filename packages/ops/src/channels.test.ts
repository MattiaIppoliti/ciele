import { describe, expect, it } from "vitest";
import {
  DEMO_MEMBER,
  DEMO_ORG,
  createOrgPinnedDb,
  getMockDb,
} from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  addChannelMembersOp,
  addChannelTeammatesOp,
  createChannelOp,
  deleteChannelOp,
  getChannelOp,
  listChannelsOp,
  listOrgChannelsOp,
  markChannelReadOp,
  postChannelMessageOp,
  readOrgChannelOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "./channels";
import { createTeammateOp, deleteTeammateOp, updateTeammateOp } from "./teammates";
import { createProjectOp } from "./memory";
import { runTeammateAction } from "./teammate-actions";

/**
 * Channel membership and mention fan-out (#778).
 *
 * The cases worth having are the refusals: a colleague who was not invited gets
 * `not_found` rather than "forbidden", an unmentioned Teammate is never a target,
 * a name from outside the channel resolves to nobody, and a private Teammate
 * cannot be seated by somebody it is not private *to*.
 */

/** A colleague who is an org member in the demo store. */
const COLLEAGUE = "u-martina";
const OUTSIDER = "u-valeria";
/**
 * A colleague who is in no channel at all. Separate from OUTSIDER because the
 * mock store is shared across cases, so the one that gets invited above cannot
 * also be the one asserted never to see anything.
 */
const NON_MEMBER = "u-andrea";

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor",
  db: getMockDb(),
  ...over,
});

async function seed(db: Db) {
  const owner = ctx({ db });
  const sam = await createTeammateOp.run(owner, { name: "Sam" });
  const nora = await createTeammateOp.run(owner, { name: "Nora" });
  const channel = await createChannelOp.run(owner, {
    name: "Launch week",
    teammateIds: [sam.id, nora.id],
  });
  return { owner, sam, nora, channel };
}

describe("channel CRUD and membership", () => {
  it("seats the creator, so the thread they opened is one they can see", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    const view = await getChannelOp.run(owner, { id: channel.id });
    expect(view.participants.filter((row) => row.userId)).toHaveLength(1);
    expect(view.participants[0].userId).toBe(DEMO_MEMBER.userId);
    expect(view.teammates.map((t) => t.name).sort()).toEqual(["Nora", "Sam"]);
    expect(view.canManage).toBe(true);
  });

  it("is invisible to a colleague who was not invited", async () => {
    const db = getMockDb();
    const { channel } = await seed(db);
    const uninvited = ctx({ db, userId: OUTSIDER });
    // `not_found`, not "forbidden": invite-based means a colleague does not
    // learn which threads exist without them.
    await expect(
      getChannelOp.run(uninvited, { id: channel.id })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await listChannelsOp.run(uninvited, {})).toEqual([]);
  });

  it("lets anybody in the channel invite, and only the creator remove", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    await addChannelMembersOp.run(owner, {
      id: channel.id,
      userIds: [COLLEAGUE],
    });
    const guest = ctx({ db, userId: COLLEAGUE });
    // The guest is in, so they may invite somebody else.
    await addChannelMembersOp.run(guest, {
      id: channel.id,
      userIds: [OUTSIDER],
    });
    expect(
      (await getChannelOp.run(guest, { id: channel.id })).participants.filter(
        (row) => row.userId
      )
    ).toHaveLength(3);

    // Removing somebody else is the creator's, or an admin's.
    await expect(
      removeChannelMemberOp.run(guest, { id: channel.id, userId: OUTSIDER })
    ).rejects.toMatchObject({ code: "invalid_input" });
    // Leaving is always yours.
    await removeChannelMemberOp.run(guest, {
      id: channel.id,
      userId: COLLEAGUE,
    });
    await expect(
      getChannelOp.run(guest, { id: channel.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("invites the same colleague twice without complaining", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    const view = await getChannelOp.run(owner, { id: channel.id });
    expect(view.participants.filter((row) => row.userId === COLLEAGUE)).toHaveLength(
      1
    );
  });

  it("seats an org-visible teammate, and refuses somebody else's private one", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    const mine = await createTeammateOp.run(
      ctx({ db, userId: COLLEAGUE }),
      { name: "Quiet", visibility: "private" }
    );
    // Private to a colleague: naming it in a channel would disclose it, so the
    // refusal is indistinguishable from "no such teammate".
    await expect(
      addChannelTeammatesOp.run(owner, {
        id: channel.id,
        teammateIds: [mine.id],
      })
    ).rejects.toMatchObject({ code: "not_found" });
    // Its own owner may seat it.
    const its = ctx({ db, userId: COLLEAGUE });
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    await addChannelTeammatesOp.run(its, {
      id: channel.id,
      teammateIds: [mine.id],
    });
    expect(
      (await getChannelOp.run(owner, { id: channel.id })).teammates.map(
        (t) => t.name
      )
    ).toContain("Quiet");
  });

  it("refuses a retired teammate rather than seating a mute colleague", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    const gone = await createTeammateOp.run(owner, { name: "Gone" });
    await deleteTeammateOp.run(owner, { id: gone.id });
    await expect(
      addChannelTeammatesOp.run(owner, {
        id: channel.id,
        teammateIds: [gone.id],
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("binds a live Project and refuses an archived one", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    const project = await db.table("projects").insert({
      organizationId: DEMO_ORG.id,
      name: "Migration",
    });
    const bound = await updateChannelOp.run(owner, {
      id: channel.id,
      patch: { projectId: project.id },
    });
    expect(bound.projectId).toBe(project.id);

    await db.table("projects").update(project.id, { archived: true });
    await expect(
      updateChannelOp.run(owner, {
        id: channel.id,
        patch: { projectId: project.id },
      })
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining("archived"),
    });
  });

  it("removes a teammate from the roster, which is the manage rule", async () => {
    const db = getMockDb();
    const { owner, channel, sam } = await seed(db);
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    const guest = ctx({ db, userId: COLLEAGUE });
    await expect(
      removeChannelTeammateOp.run(guest, { id: channel.id, teammateId: sam.id })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await removeChannelTeammateOp.run(owner, {
      id: channel.id,
      teammateId: sam.id,
    });
    expect(
      (await getChannelOp.run(owner, { id: channel.id })).teammates.map(
        (t) => t.name
      )
    ).toEqual(["Nora"]);
  });

  it("deletes the thread, transcript and roster together", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    await postChannelMessageOp.run(owner, { id: channel.id, message: "hello" });
    await deleteChannelOp.run(owner, { id: channel.id });
    await expect(
      getChannelOp.run(owner, { id: channel.id })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await db.listChannelMessages(channel.id)).toEqual([]);
  });
});

describe("mention fan-out", () => {
  it("targets exactly the teammates a message named", async () => {
    const db = getMockDb();
    const { owner, channel, sam } = await seed(db);
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@Sam can you look at the crawl?",
    });
    expect(posted.targets).toEqual([sam.id]);
    expect(posted.message.mentions).toEqual([sam.id]);
    expect(posted.message.authorUserId).toBe(DEMO_MEMBER.userId);
    expect(posted.message.chainId).toBeNull();
  });

  it("asks nobody when nobody was named", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "morning all",
    });
    // Two teammates are sitting here and neither was addressed, so neither
    // speaks: mention-only, with no default responder (#775).
    expect(posted.targets).toEqual([]);
  });

  it("records a member mention without asking it to answer", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@martina.binacci any thoughts?",
    });
    expect(posted.message.mentions).toEqual([COLLEAGUE]);
    // A person is not a target: nothing runs, and the mention is what makes
    // their unread badge the loud one.
    expect(posted.targets).toEqual([]);
  });

  it("cannot reach a teammate outside the channel", async () => {
    const db = getMockDb();
    const { owner, channel, sam } = await seed(db);
    const elsewhere = await createTeammateOp.run(owner, { name: "Scheduler" });
    await removeChannelTeammateOp.run(owner, {
      id: channel.id,
      teammateId: sam.id,
    });
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@Scheduler take this, and @Sam too",
    });
    // Neither is seated here, so neither resolves. The channel is the
    // perimeter, and it needs no refusal to be one.
    expect(posted.targets).toEqual([]);
    expect(posted.message.mentions).toEqual([]);
    expect(elsewhere.id).not.toBe("");
  });

  it("never targets a teammate that was retired after being seated", async () => {
    const db = getMockDb();
    const { owner, channel, sam } = await seed(db);
    await deleteTeammateOp.run(owner, { id: sam.id });
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@Sam are you there?",
    });
    // The seat and the history stay; the answering does not (#767).
    expect(posted.targets).toEqual([]);
  });

  it("follows a renamed teammate, because mentions resolve at post time", async () => {
    const db = getMockDb();
    const { owner, channel, sam } = await seed(db);
    await updateTeammateOp.run(owner, {
      id: sam.id,
      patch: { name: "Sam the Second" },
    });
    const posted = await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@Sam the Second please",
    });
    expect(posted.targets).toEqual([sam.id]);
  });

  it("refuses to post into a channel the caller is not in", async () => {
    const db = getMockDb();
    const { channel } = await seed(db);
    await expect(
      postChannelMessageOp.run(ctx({ db, userId: OUTSIDER }), {
        id: channel.id,
        message: "let me in",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("unread state", () => {
  it("counts what a colleague said, and shouts only when you were named", async () => {
    const db = getMockDb();
    const { owner, channel } = await seed(db);
    await addChannelMembersOp.run(owner, { id: channel.id, userIds: [COLLEAGUE] });
    const guest = ctx({ db, userId: COLLEAGUE });
    // A fresh seat has no read marker, so everything said in the channel is
    // unread. Asserted by channel id rather than by position: both of these
    // colleagues are in other channels from other cases.
    const seen = async (context: OperationContext) =>
      (await listChannelsOp.run(context, {})).find(
        (row) => row.channel.id === channel.id
      )!;

    await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "some background",
    });
    expect((await seen(guest)).unread).toEqual({
      count: 1,
      mentionsYou: false,
    });

    await postChannelMessageOp.run(owner, {
      id: channel.id,
      message: "@martina.binacci over to you",
    });
    expect((await seen(guest)).unread).toEqual({ count: 2, mentionsYou: true });

    // The poster's own message is never their unread.
    expect((await seen(owner)).unread.count).toBe(0);

    await markChannelReadOp.run(guest, { id: channel.id });
    const read = await seen(guest);
    expect(read.unread).toEqual({ count: 0, mentionsYou: false });
    expect(read.lastMessagePreview).toContain("over to you");
  });
});

describe("oversight", () => {
  it("shows an admin every channel, membership or not", async () => {
    const db = getMockDb();
    const { channel } = await seed(db);
    const admin = ctx({ db, userId: NON_MEMBER, role: "admin" });
    // The roster read still refuses: oversight is the Inbox, not the sidebar.
    expect(await listChannelsOp.run(admin, {})).toEqual([]);
    const all = await listOrgChannelsOp.run(admin, {});
    expect(all.map((row) => row.channel.id)).toContain(channel.id);
    const view = await readOrgChannelOp.run(admin, { id: channel.id });
    expect(view.channel.id).toBe(channel.id);
    // Reading is not managing: an admin overseeing a thread does not inherit
    // the right to rename it from this read.
    expect(view.canManage).toBe(false);
  });

  it("is capability-gated, not membership-gated", async () => {
    // The capability the surface enforces is declared, so an Editor cannot
    // reach the oversight read at all.
    expect(listOrgChannelsOp.capability).toBe("manageMembers");
    expect(readOrgChannelOp.capability).toBe("manageMembers");
    // Everything a colleague does in a channel of their own is `member`.
    expect(createChannelOp.capability).toBe("member");
    expect(postChannelMessageOp.capability).toBe("member");
  });
});

describe("attribution across a chain (#778, story 8)", () => {
  /**
   * One turn as one Teammate, shaped the way `resolveTeammateActions` shapes it
   * for a channel: the Teammate is the actor, the chain-starting Member is the
   * id every mutation records, and the Project the tool writes to is the
   * channel's rather than whichever one the Teammate carries (story 11).
   */
  const turnAs = (
    db: Db,
    teammate: { id: string; name: string },
    projectId: string | null,
    startedBy: string
  ): OperationContext => ({
    organizationId: DEMO_ORG.id,
    userId: startedBy,
    // A Viewer, deliberately: capability is the Teammate's, attribution is the
    // Member's, and a chain must not quietly become the exception.
    role: "viewer",
    db: createOrgPinnedDb(db, DEMO_ORG.id),
    teammate: {
      id: teammate.id,
      name: teammate.name,
      ceiling: "edit",
      grants: [],
      approvalBypass: false,
      projectId,
    },
  });

  it("records the member who started it, including for a teammate they never named", async () => {
    const db = getMockDb();
    const context = ctx({ db });
    const project = await createProjectOp.run(context, {
      name: "Launch plan",
      description: "",
    });
    const chief = await createTeammateOp.run(context, { name: "Chief" });
    const scheduler = await createTeammateOp.run(context, { name: "Scheduler" });
    const channel = await createChannelOp.run(context, {
      name: "Launch",
      teammateIds: [chief.id, scheduler.id],
      projectId: project.id,
    });

    // Ada names one colleague. The Scheduler's turn happens because the Chief
    // named it, which is the case the invariant is actually about.
    const posted = await postChannelMessageOp.run(context, {
      id: channel.id,
      message: "@Chief can we still ship on the 30th?",
    });
    expect(posted.targets).toEqual([chief.id]);

    for (const speaker of [chief, scheduler]) {
      await runTeammateAction(
        turnAs(db, speaker, channel.projectId, DEMO_MEMBER.userId),
        "memory.project.record",
        {
          body: `Ship on the 30th. Noted by ${speaker.name}.`,
          note: "settled in the launch channel",
        }
      );
    }

    // The decisions landed in the channel's Project, not in either Teammate's.
    const document = await db.getMemoryDocument(DEMO_ORG.id, {
      scope: "project",
      projectId: project.id,
    });
    const entries = await db.listMemoryDocumentEntries(document!.id);
    expect(entries.map((entry) => entry.teammateId)).toEqual([
      scheduler.id,
      chief.id,
    ]);
    // Both turns are Ada's, though Ada only ever spoke to one of them.
    expect(entries.map((entry) => entry.authorId)).toEqual([
      DEMO_MEMBER.userId,
      DEMO_MEMBER.userId,
    ]);
  });
});
