import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
}));

import { revalidatePath, revalidateTag } from "next/cache";
import { requireMember } from "@/lib/authz";
import { orgMutation } from "./org-mutation";

describe("orgMutation", () => {
  const requireMemberMock = vi.mocked(requireMember);
  const revalidatePathMock = vi.mocked(revalidatePath);
  const revalidateTagMock = vi.mocked(revalidateTag);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    revalidatePathMock.mockReset();
    revalidateTagMock.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: { organization: DEMO_ORG },
    } as never);
  });

  it("enforces the capability, runs the mutation, and derives revalidation", async () => {
    const assistant = await orgMutation(
      { capability: "edit", entities: [{ kind: "assistantList" }] },
      ({ db, session }) =>
        db.createAssistant(session.organization.id, { title: "Helper made" })
    );

    expect(requireMemberMock).toHaveBeenCalledWith("edit");
    // Observable Db state, not call ordering.
    const listed = await db.listAssistants(DEMO_ORG.id);
    expect(listed.some((a) => a.id === assistant.id)).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith("/", undefined);
  });

  it("propagates the capability rejection without running the mutation", async () => {
    requireMemberMock.mockRejectedValue(new Error("Not allowed"));
    const fn = vi.fn();
    await expect(
      orgMutation({ capability: "publish", entities: [] }, fn)
    ).rejects.toThrow("Not allowed");
    expect(fn).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("expires the Organization's Insights cache for the kinds the aggregate reads", async () => {
    for (const entities of [
      [{ kind: "inbox" as const }],
      [{ kind: "assistant" as const, id: "as_1" }],
      [{ kind: "improvement" as const, id: "imp_1" }],
    ]) {
      revalidateTagMock.mockReset();
      await orgMutation({ capability: "edit", entities }, async () => null);
      expect(revalidateTagMock).toHaveBeenCalledExactlyOnceWith(
        `insights:${DEMO_ORG.id}`,
        { expire: 0 },
      );
    }
  });

  it("leaves the Insights cache alone for mutations the aggregate never reads", async () => {
    await orgMutation(
      { capability: "changeRoles", entities: [{ kind: "members" }] },
      async () => null,
    );
    await orgMutation(
      { capability: "edit", entities: [{ kind: "helpDeskList" }] },
      async () => null,
    );
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("fans one entity out to all its routes, layout scope included", async () => {
    await orgMutation(
      { capability: "edit", entities: [{ kind: "assistant", id: "as_1" }] },
      async () => null
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/", undefined],
      ["/assistants/as_1", "layout"],
    ]);
  });

  it("dedupes overlapping routes across entities", async () => {
    await orgMutation(
      {
        capability: "edit",
        entities: [
          { kind: "assistantList" },
          { kind: "assistant", id: "as_1" },
          { kind: "flows", assistantId: "as_1" },
        ],
      },
      async () => null
    );
    // "/" appears in two entities but revalidates once; the flows page and
    // the assistant layout are distinct scopes of distinct paths.
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/", undefined],
      ["/assistants/as_1", "layout"],
      ["/assistants/as_1", undefined],
    ]);
  });

  it("derives entities from the result when ids are only known afterwards", async () => {
    await orgMutation(
      {
        capability: "edit",
        entities: (result: { id: string }) => [
          { kind: "assistant", id: result.id },
        ],
      },
      async () => ({ id: "as_new" })
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/", undefined],
      ["/assistants/as_new", "layout"],
    ]);
  });

  it("skips revalidation when revalidateIf rejects the result", async () => {
    const result = await orgMutation(
      {
        capability: "edit",
        entities: [{ kind: "assistantList" }],
        revalidateIf: (r: { error?: string }) => !r.error,
      },
      async () => ({ error: "Choose an image file" })
    );
    expect(result.error).toBe("Choose an image file");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns the mutation result untouched for redirect/return flows", async () => {
    const result = await orgMutation(
      { capability: "member", entities: [] },
      async () => ({ nested: { value: 42 } })
    );
    expect(result).toEqual({ nested: { value: 42 } });
  });

  // The widened entity→path map (arch candidate #1): every route family an
  // org-scoped action can touch, each reproducing the exact paths the action
  // used to hand-list.
  it.each([
    [{ kind: "helpDeskList" }, [["/help-desks", undefined]]],
    [{ kind: "helpDesk", id: "hd_1" }, [["/help-desks/hd_1", undefined]]],
    [{ kind: "aiSettings" }, [["/settings/ai", undefined]]],
    [{ kind: "members" }, [["/settings/members", undefined]]],
    [{ kind: "alerts" }, [["/alerts", undefined]]],
    [{ kind: "improvementList" }, [["/improvements", undefined]]],
    [{ kind: "improvement", id: "IMP_1" }, [["/improvements/IMP_1", undefined]]],
    [{ kind: "inbox" }, [["/inbox", undefined]]],
    [{ kind: "assistantEditor", assistantId: "as_1" }, [["/assistants/as_1", undefined]]],
    // A channel change reaches the roster it shares with the Teammates, and one
    // channel's own page. Both are concrete paths, so neither needs a type
    // (#778).
    [{ kind: "channelList" }, [["/teammates", undefined]]],
    [
      { kind: "channel", id: "ch_1" },
      [["/teammates/channels/ch_1", undefined]],
    ],
    // A Project change reaches the roster (whose create dialog offers the
    // live Projects), every Teammate page, and the Improvements board, where
    // an Improvement names the Project it belongs to. The bracketed path is
    // how Next names a dynamic route for all of its params, and it only works
    // with the explicit "page" type.
    [
      { kind: "projectList" },
      [
        ["/teammates", undefined],
        ["/teammates/[teammateId]", "page"],
        ["/improvements", undefined],
      ],
    ],
    [
      { kind: "project", id: "prj_1" },
      [
        ["/teammates", undefined],
        ["/teammates/[teammateId]", "page"],
        ["/improvements", undefined],
      ],
    ],
  ] as const)("maps %o to its route(s)", async (entity, expectedCalls) => {
    await orgMutation({ capability: "edit", entities: [entity] }, async () => null);
    expect(revalidatePathMock.mock.calls).toEqual(expectedCalls);
  });

  it("composes atomic entities into the exact hand-listed set (updateHelpDesk)", async () => {
    await orgMutation(
      {
        capability: "edit",
        entities: [{ kind: "helpDeskList" }, { kind: "helpDesk", id: "hd_1" }],
      },
      async () => null
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/help-desks", undefined],
      ["/help-desks/hd_1", undefined],
    ]);
  });

  it("dedupes the Project pair down to the routes they share", async () => {
    // What `projects.update` declares: one Project changed, and so did the set
    // of them. Both map to the same two routes, and each is revalidated once.
    await orgMutation(
      {
        capability: "edit",
        entities: [{ kind: "project", id: "prj_1" }, { kind: "projectList" }],
      },
      async () => null
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/teammates", undefined],
      ["/teammates/[teammateId]", "page"],
      ["/improvements", undefined],
    ]);
  });

  it("composes the improvement-link fan-out (list + item + inbox)", async () => {
    await orgMutation(
      {
        capability: "edit",
        entities: [
          { kind: "improvementList" },
          { kind: "improvement", id: "IMP_1" },
          { kind: "inbox" },
        ],
      },
      async () => null
    );
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/improvements", undefined],
      ["/improvements/IMP_1", undefined],
      ["/inbox", undefined],
    ]);
  });
});
