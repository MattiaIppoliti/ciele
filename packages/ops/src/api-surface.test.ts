import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  createTeammateOp,
  deleteTeammateOp,
  getTeammateOp,
  listTeammateThreadOp,
  listTeammatesOp,
  readTeammateConversationOp,
  updateTeammateOp,
} from "./teammates";
import { addOrgSourceOp, listCollectionsOp } from "./knowledge";
import { readUsageMetersOp, readUsageSpendersOp } from "./usage";
import { createAssistantOp } from "./assistants";
import {
  createFlowOp,
  listFlowsOp,
  draftFlowOp,
  listHttpFlowRunsOp,
  proposeFlowOp,
} from "./flows";
import {
  listFlowsAgentThreadOp,
  readFlowsAgentConversationOp,
} from "./flows-agent";
import { listTeammateGrantsOp, setTeammateGrantsOp } from "./teammate-grants";
import {
  createRoutineOp,
  deleteRoutineOp,
  listRoutinesOp,
  updateRoutineOp,
} from "./routines";
import {
  createProjectOp,
  deleteProjectOp,
  getProjectOp,
  getTeammateMemoryOp,
  listProjectsOp,
  updateProjectOp,
  writeProjectDocumentOp,
  writeTeammateMemoryOp,
} from "./memory";
import {
  addChannelMembersOp,
  addChannelTeammatesOp,
  createChannelOp,
  deleteChannelOp,
  getChannelOp,
  listChannelsOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "./channels";

/**
 * The operations /api/v1 exposes, run on the Db /api/v1 actually gives them.
 *
 * A key request has no Supabase session, so it runs on `createOrgPinnedDb`, a
 * fail-closed view where an unexposed method throws rather than answering. The
 * three drift tests in `apps/web` check that a route, a CLI verb and an MCP
 * action agree about a *name*; none of them calls the operation. So the
 * Teammates domain shipped with seven endpoints that every one of those tests
 * passed and that threw `OrgPinnedDbError` the first time anybody called them.
 *
 * This is the gate that was missing. It is deliberately about reachability,
 * not behaviour: behaviour is tested next door against the plain mock. A new
 * endpoint belongs here the moment its route exists.
 */

const pinned = (inner: Db = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const keyContext = (db: Db): OperationContext => ({
  organizationId: DEMO_ORG.id,
  // An API key acts as the Member who minted it (`actorUserId: key.createdBy`).
  userId: DEMO_MEMBER.userId,
  role: "owner",
  db,
});

describe("the Teammates domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const ctx = keyContext(pinned());
    const teammate = await createTeammateOp.run(ctx, { name: "Key Probe" });

    const list = await listTeammatesOp.run(ctx, {});
    expect(list.map((row) => row.id)).toContain(teammate.id);
    expect((await getTeammateOp.run(ctx, { id: teammate.id })).name).toBe(
      "Key Probe"
    );
    const updated = await updateTeammateOp.run(ctx, {
      id: teammate.id,
      patch: { title: "Probe" },
    });
    expect(updated.title).toBe("Probe");
    await deleteTeammateOp.run(ctx, { id: teammate.id });
  });

  it("reads the key holder's own Teammate thread through the pinned view", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const teammate = await createTeammateOp.run(ctx, { name: "Thread Probe" });
    // Seeded on the inner Db: a turn is what creates these, and a key cannot
    // run one. What matters is that the two reads behind the endpoints resolve
    // through the pinned view.
    const conversation = await inner.createConversation({
      teammateId: teammate.id,
      subjectType: "member",
      subjectId: DEMO_MEMBER.userId,
      title: "Earlier",
    });
    await inner.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });

    const thread = await listTeammateThreadOp.run(ctx, { id: teammate.id });
    expect(thread.map((row) => row.id)).toEqual([conversation.id]);
    const read = await readTeammateConversationOp.run(ctx, {
      id: teammate.id,
      conversationId: conversation.id,
    });
    expect(read.messages).toHaveLength(1);
    await expect(
      readTeammateConversationOp.run(ctx, {
        id: teammate.id,
        conversationId: "no-such-conversation",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("still refuses another Organization's Teammate", async () => {
    const inner = getMockDb();
    const foreign = await inner.table("teammates").insert({
      organizationId: "some-other-org",
      ownerId: "someone-else",
      name: "Theirs",
    });
    const ctx = keyContext(pinned(inner));
    // The pinned view resolves the row to its owner and reads it as absent, so
    // the operation's own `not_found` is what the caller sees.
    await expect(
      getTeammateOp.run(ctx, { id: foreign.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the Channels domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const teammate = await createTeammateOp.run(ctx, { name: "Channel Probe" });
    const channel = await createChannelOp.run(ctx, {
      name: "Key channel",
      teammateIds: [teammate.id],
    });

    const mine = await listChannelsOp.run(ctx, {});
    expect(mine.map((row) => row.channel.id)).toContain(channel.id);

    const view = await getChannelOp.run(ctx, { id: channel.id });
    expect(view.teammates.map((row) => row.id)).toEqual([teammate.id]);
    expect(view.messages).toEqual([]);

    const renamed = await updateChannelOp.run(ctx, {
      id: channel.id,
      patch: { name: "Renamed" },
    });
    expect(renamed.name).toBe("Renamed");

    await addChannelMembersOp.run(ctx, {
      id: channel.id,
      userIds: ["u-martina"],
    });
    await removeChannelMemberOp.run(ctx, {
      id: channel.id,
      userId: "u-martina",
    });
    await addChannelTeammatesOp.run(ctx, {
      id: channel.id,
      teammateIds: [teammate.id],
    });
    await removeChannelTeammateOp.run(ctx, {
      id: channel.id,
      teammateId: teammate.id,
    });
    await deleteChannelOp.run(ctx, { id: channel.id });
    expect(
      (await listChannelsOp.run(ctx, {})).map((row) => row.channel.id)
    ).not.toContain(channel.id);
  });

  it("refuses another Organization's channel as if it did not exist", async () => {
    const inner = getMockDb();
    const foreign = await inner.table("teammateChannels").insert({
      organizationId: "some-other-org",
      name: "Theirs",
      createdBy: "someone-else",
    });
    await inner.table("teammateChannelParticipants").insert({
      organizationId: "some-other-org",
      channelId: foreign.id,
      userId: DEMO_MEMBER.userId,
    });
    const ctx = keyContext(pinned(inner));
    // Even a seat in it does not make it readable: the pinned view resolves the
    // channel to its Organization first.
    await expect(
      getChannelOp.run(ctx, { id: foreign.id })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await listChannelsOp.run(ctx, {})).map((row) => row.channel.id)
    ).not.toContain(foreign.id);
  });
});

describe("the org-level knowledge add over an API key", () => {
  it("resolves the Knowledge Library through the pinned view", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const assistant = await createAssistantOp.run(ctx, { title: "Key Library" });
    // Nothing to name yet: this is the state the collection-scoped add cannot
    // serve, and the reason this operation exists.
    expect(await listCollectionsOp.run(ctx, { assistantId: assistant.id })).toEqual(
      []
    );

    const { source } = await addOrgSourceOp.run(ctx, {
      name: "Handbook",
      kind: "text",
      rawText: "Opening hours are 09:00 to 17:00.",
      assistantIds: [assistant.id],
    });

    const library = await inner.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
    expect(source.collectionId).toBe(library.id);
    expect(
      (await listCollectionsOp.run(ctx, { assistantId: assistant.id })).map(
        (collection) => collection.id
      )
    ).toEqual([library.id]);
  });
});

describe("Teammate governance and routines over an API key", () => {
  it("runs the grant endpoints' operations on the pinned Db", async () => {
    const ctx = keyContext(pinned());
    const teammate = await createTeammateOp.run(ctx, { name: "Grant Probe" });

    // Absence is refusal, so a fresh Teammate starts with nothing.
    expect((await listTeammateGrantsOp.run(ctx, { id: teammate.id })).domains).toEqual(
      []
    );

    const armed = await setTeammateGrantsOp.run(ctx, {
      id: teammate.id,
      domains: ["improvements", "knowledge"],
      ceiling: "edit",
      approvalBypass: true,
    });
    expect(armed.domains).toEqual(["improvements", "knowledge"]);
    expect(armed.ceiling).toBe("edit");
    expect(armed.approvalBypass).toBe(true);

    // Whole-set replace, so a shorter list revokes rather than adds.
    expect(
      (await setTeammateGrantsOp.run(ctx, { id: teammate.id, domains: [] })).domains
    ).toEqual([]);
    await deleteTeammateOp.run(ctx, { id: teammate.id });
  });

  it("runs the routine endpoints' operations on the pinned Db", async () => {
    const ctx = keyContext(pinned());
    const teammate = await createTeammateOp.run(ctx, { name: "Routine Probe" });

    const routine = await createRoutineOp.run(ctx, {
      teammateId: teammate.id,
      instruction: "Triage new feedback",
      cadence: "daily",
      hour: 8,
    });
    expect(
      (await listRoutinesOp.run(ctx, { teammateId: teammate.id })).map((row) => row.id)
    ).toEqual([routine.id]);

    expect(
      (await updateRoutineOp.run(ctx, { id: routine.id, patch: { enabled: false } }))
        .enabled
    ).toBe(false);

    await deleteRoutineOp.run(ctx, { id: routine.id });
    expect(await listRoutinesOp.run(ctx, { teammateId: teammate.id })).toEqual([]);
    await deleteTeammateOp.run(ctx, { id: teammate.id });
  });
});

describe("Projects and the Agent memory layer over an API key", () => {
  it("runs every Project endpoint's operation on the pinned Db", async () => {
    const ctx = keyContext(pinned());
    const project = await createProjectOp.run(ctx, {
      name: "Q4 migration",
      description: "",
    });
    expect((await listProjectsOp.run(ctx, {})).map((row) => row.id)).toContain(
      project.id
    );

    // The read serves the row AND its document with history, so it exercises
    // `getMemoryDocument` + `listMemoryDocumentEntries` through the pinned view,
    // which is the pair that was never exposed before these routes.
    const empty = await getProjectOp.run(ctx, { id: project.id });
    expect(empty.document).toBeNull();
    expect(empty.entries).toEqual([]);

    await writeProjectDocumentOp.run(ctx, {
      id: project.id,
      body: "Ship the migration before the freeze.",
      note: "kickoff",
    });
    const written = await getProjectOp.run(ctx, { id: project.id });
    expect(written.document?.body).toContain("before the freeze");
    expect(written.entries).toHaveLength(1);

    expect(
      (await updateProjectOp.run(ctx, { id: project.id, patch: { archived: true } }))
        .archived
    ).toBe(true);
    await deleteProjectOp.run(ctx, { id: project.id });
  });

  it("cannot read another Organization's memory history, even given its id", async () => {
    const inner = getMockDb();
    // A document that belongs to somebody else, and a key that knows its id.
    const foreign = await inner.writeMemoryDocument({
      organizationId: "some-other-org",
      owner: { scope: "project", projectId: "their-project" },
      body: "Their private notes.",
      note: "theirs",
    });
    expect(
      await inner.listMemoryDocumentEntries("some-other-org", foreign.id)
    ).toHaveLength(1);

    // The API surface runs service-role with RLS bypassed, so the pinned proxy
    // is the only thing standing between a caller-supplied document id and
    // another tenant's history. It substitutes the Organization rather than
    // trusting that no operation will ever pass an id from input.
    const pinnedDb = pinned(inner);
    expect(
      await pinnedDb.listMemoryDocumentEntries("some-other-org", foreign.id)
    ).toEqual([]);
  });

  it("reads and writes a Teammate's Agent memory through the pinned view", async () => {
    const ctx = keyContext(pinned());
    const teammate = await createTeammateOp.run(ctx, { name: "Memory Probe" });

    expect((await getTeammateMemoryOp.run(ctx, { id: teammate.id })).document).toBeNull();
    await writeTeammateMemoryOp.run(ctx, {
      id: teammate.id,
      body: "Refund questions go to the billing desk.",
      note: "learned",
    });
    const view = await getTeammateMemoryOp.run(ctx, { id: teammate.id });
    expect(view.document?.body).toContain("billing desk");
    expect(view.entries).toHaveLength(1);

    await deleteTeammateOp.run(ctx, { id: teammate.id });
  });
});

describe("the Flows authoring and operator reads over an API key", () => {
  it("checks a patch and a whole Flow without storing either", async () => {
    const ctx = keyContext(pinned());
    const assistant = await createAssistantOp.run(ctx, { title: "Draft probe" });
    const before = await listFlowsOp.run(ctx, { assistantId: assistant.id });

    // Both answer with what *would* be stored. The human-review action ahead of
    // a Connector write is inserted by the runtime, so this is the only way an
    // author sees it before committing.
    const draft = await draftFlowOp.run(ctx, {
      summary: "add a refund branch",
      currentTrigger: "message",
      patch: { actions: ["connector"] },
    });
    expect(draft.applied).toBe("draft");
    expect(draft.patch.actions).toContain("human_review");

    const proposed = await proposeFlowOp.run(ctx, {
      assistantId: assistant.id,
      rationale: "refunds deserve their own flow",
      flow: { name: "Refunds", trigger: "message", actions: ["connector"] },
    });
    expect(proposed.proposal.actions).toContain("human_review");

    // Neither stored anything, which is the property that makes them safe to
    // call before writing.
    expect(await listFlowsOp.run(ctx, { assistantId: assistant.id })).toHaveLength(
      before.length
    );
  });

  it("reads an HTTP Flow's runs through the pinned view", async () => {
    const inner = getMockDb();
    const ctx = keyContext(pinned(inner));
    const assistant = await createAssistantOp.run(ctx, { title: "Runs probe" });
    const flow = await createFlowOp.run(ctx, {
      assistantId: assistant.id,
      input: { name: "Inbound", trigger: "http_request", actions: ["respond"] },
    });

    expect(await listHttpFlowRunsOp.run(ctx, { flowId: flow.id, limit: 20 })).toEqual(
      []
    );
    await inner.table("httpFlowRuns").insert({
      organizationId: DEMO_ORG.id,
      flowId: flow.id,
      assistantId: assistant.id,
      publicationId: null,
      method: "POST",
      // The HTTP status the caller was answered, not a word.
      status: 200,
      ran: ["respond"],
      failedAction: null,
      failedMessage: null,
      durationMs: 12,
    });
    const [run] = await listHttpFlowRunsOp.run(ctx, { flowId: flow.id, limit: 20 });
    expect(run.status).toBe(200);
    expect(run.ran).toEqual(["respond"]);
  });

  it("reads usage through the pinned view, and says so when nothing is metered", async () => {
    const ctx = keyContext(pinned());
    // No enterprise port wired, which is every open-source deployment: the read
    // answers "unmetered" rather than zeroed meters.
    expect(await readUsageMetersOp.run(ctx, {})).toMatchObject({
      metered: false,
      plan: null,
      meters: [],
    });
    // The spender read runs on the pinned Db, the thing three name-checking
    // drift tests cannot prove.
    const spenders = await readUsageSpendersOp.run(ctx, {});
    expect(Array.isArray(spenders.dimensions)).toBe(true);
    expect(Date.parse(spenders.from)).toBeLessThan(Date.parse(spenders.to));
  });

  it("refuses a window it cannot answer honestly", async () => {
    const ctx = keyContext(pinned());
    await expect(
      readUsageSpendersOp.run(ctx, {
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      readUsageSpendersOp.run(ctx, {
        from: "2020-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("reads the key holder's own Flows Agent thread, empty before a canvas opens", async () => {
    const ctx = keyContext(pinned());
    const assistant = await createAssistantOp.run(ctx, { title: "Agent probe" });
    // No Flows Agent exists until the canvas creates one, and the read answers
    // with nothing rather than failing.
    expect(
      await listFlowsAgentThreadOp.run(ctx, { assistantId: assistant.id, flowId: null })
    ).toEqual([]);
    await expect(
      readFlowsAgentConversationOp.run(ctx, {
        assistantId: assistant.id,
        conversationId: "nope",
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
