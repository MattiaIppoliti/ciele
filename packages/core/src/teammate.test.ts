import { describe, expect, it } from "vitest";
import {
  canEditTeammate,
  canViewTeammate,
  isTeammateRetired,
  teammatePersonaPrompt,
  teammateSearchesKnowledge,
  rosterTeammates,
  visibleTeammates,
} from "./teammate";
import type { Role, Teammate } from "./types";

/**
 * The Teammate derivations (#768). Pure: no database, no clock, no runtime.
 *
 * Two of these decide who can see and change an org's internal agents, so the
 * cases are written from the refusal side: the interesting assertion is always
 * the one that says no.
 */

function makeTeammate(overrides: Partial<Teammate> = {}): Teammate {
  return {
    id: "tm-1",
    organizationId: "org-1",
    name: "Nora",
    title: "Support Copywriter",
    roleDescription: "You draft replies to support questions from our docs.",
    avatarSeed: "",
    ownerId: "member-owner",
    editorIds: [],
    visibility: "org",
    collectionIds: [],
    sourceIds: [],
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    capabilityCeiling: "edit",
    approvalBypass: false,
    projectId: null,
    deletedAt: null,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    ...overrides,
  };
}

const viewer = (userId: string, role: Role) => ({ userId, role });

describe("teammatePersonaPrompt", () => {
  it("names the Teammate and states its standing role", () => {
    const prompt = teammatePersonaPrompt(makeTeammate());
    expect(prompt).toContain("Nora");
    expect(prompt).toContain("Support Copywriter");
    expect(prompt).toContain("You draft replies to support questions");
  });

  it("says the reader is a colleague, not a website visitor", () => {
    const prompt = teammatePersonaPrompt(makeTeammate()).toLowerCase();
    expect(prompt).toContain("colleague");
    expect(prompt).not.toContain("visitor");
  });

  it("survives a Teammate with only a name", () => {
    const prompt = teammatePersonaPrompt(
      makeTeammate({ title: "", roleDescription: "" })
    );
    expect(prompt).toContain("Nora");
    // No dangling label for a field the Member left empty.
    expect(prompt).not.toMatch(/:\s*$/m);
  });

  it("tells a scopeless Teammate it cannot look anything up", () => {
    const scopeless = teammatePersonaPrompt(makeTeammate());
    const scoped = teammatePersonaPrompt(
      makeTeammate({ collectionIds: ["col-1"] })
    );
    expect(scopeless).toMatch(/no knowledge/i);
    expect(scoped).not.toMatch(/no knowledge/i);
  });
});

describe("teammateSearchesKnowledge", () => {
  it("is false for an empty scope: a pure-persona Teammate", () => {
    expect(teammateSearchesKnowledge(makeTeammate())).toBe(false);
  });

  it("is true as soon as one Collection is in scope", () => {
    expect(
      teammateSearchesKnowledge(makeTeammate({ collectionIds: ["col-1"] }))
    ).toBe(true);
  });
});

describe("canViewTeammate", () => {
  const orgWide = makeTeammate();
  const privateOne = makeTeammate({ visibility: "private" });

  it("shows an org-visible Teammate to every Member, Viewers included", () => {
    expect(canViewTeammate(orgWide, viewer("someone", "viewer"))).toBe(true);
  });

  it("hides a private Teammate from a colleague who is not an admin", () => {
    expect(canViewTeammate(privateOne, viewer("someone", "editor"))).toBe(false);
  });

  it("shows a private Teammate to its owner and to admins", () => {
    expect(canViewTeammate(privateOne, viewer("member-owner", "editor"))).toBe(
      true
    );
    expect(canViewTeammate(privateOne, viewer("someone", "admin"))).toBe(true);
    expect(canViewTeammate(privateOne, viewer("someone", "owner"))).toBe(true);
  });

  it("shows a private Teammate to a Member named as its editor", () => {
    const shared = makeTeammate({
      visibility: "private",
      editorIds: ["colleague"],
    });
    expect(canViewTeammate(shared, viewer("colleague", "editor"))).toBe(true);
  });

  it("still admits a retired Teammate, which is what keeps its history readable", () => {
    // The tombstone belongs to the roster and to writes, not to reads: the
    // Teammate's own thread is the only place its past Conversations live.
    const retired = makeTeammate({ deletedAt: "2026-08-21T11:00:00.000Z" });
    expect(isTeammateRetired(retired)).toBe(true);
    expect(canViewTeammate(retired, viewer("member-owner", "owner"))).toBe(true);
    expect(canEditTeammate(retired, viewer("member-owner", "owner"))).toBe(false);
  });
});

describe("canEditTeammate", () => {
  it("refuses a Viewer, even one named as an editor", () => {
    const shared = makeTeammate({ editorIds: ["read-only"] });
    // The org Role is the ceiling: a per-Teammate grant cannot lift it.
    expect(canEditTeammate(shared, viewer("read-only", "viewer"))).toBe(false);
  });

  it("refuses an Editor who neither owns it nor is named on it", () => {
    expect(canEditTeammate(makeTeammate(), viewer("stranger", "editor"))).toBe(
      false
    );
  });

  it("allows the owner, a named editor, and any admin", () => {
    const shared = makeTeammate({ editorIds: ["colleague"] });
    expect(canEditTeammate(shared, viewer("member-owner", "editor"))).toBe(true);
    expect(canEditTeammate(shared, viewer("colleague", "editor"))).toBe(true);
    expect(canEditTeammate(shared, viewer("stranger", "admin"))).toBe(true);
  });

  it("refuses every edit to a soft-deleted Teammate", () => {
    const deleted = makeTeammate({ deletedAt: "2026-08-21T11:00:00.000Z" });
    expect(canEditTeammate(deleted, viewer("someone", "owner"))).toBe(false);
  });
});

describe("visibleTeammates", () => {
  it("keeps the roster to what this Member may see, in one pass", () => {
    const mine = makeTeammate({ id: "mine", visibility: "private" });
    const theirs = makeTeammate({
      id: "theirs",
      visibility: "private",
      ownerId: "someone-else",
    });
    const shared = makeTeammate({ id: "shared" });
    const gone = makeTeammate({ id: "gone", deletedAt: "2026-08-21T11:00:00Z" });

    const roster = visibleTeammates(
      [mine, theirs, shared, gone],
      viewer("member-owner", "editor")
    );
    // Someone else's private one and the retired one both drop out, for
    // different reasons: permission, and there being nothing to say to it.
    expect(roster.map((t) => t.id)).toEqual(["mine", "shared"]);
  });
});

describe("rosterTeammates", () => {
  it("drops the ones this Member hid, and only for them", () => {
    const kept = makeTeammate({ id: "kept" });
    const hidden = makeTeammate({ id: "hidden" });
    const viewer = { userId: "member-owner", role: "editor" as Role };

    // Hiding is a fact about one Member's list. The Teammate is untouched, so
    // the same call for a colleague who hid nothing still returns both.
    expect(
      rosterTeammates([kept, hidden], viewer, ["hidden"]).map((t) => t.id)
    ).toEqual(["kept"]);
    expect(
      rosterTeammates([kept, hidden], viewer, []).map((t) => t.id)
    ).toEqual(["kept", "hidden"]);
  });

  it("is visibleTeammates when nothing is hidden", () => {
    const teammates = [
      makeTeammate({ id: "org-wide" }),
      makeTeammate({ id: "someone-elses", visibility: "private", ownerId: "x" }),
    ];
    const viewer = { userId: "member-owner", role: "editor" as Role };
    expect(rosterTeammates(teammates, viewer, [])).toEqual(
      visibleTeammates(teammates, viewer)
    );
  });

  it("cannot resurrect one the visibility rule already refused", () => {
    // Hiding narrows and never widens: an id absent from the hidden list is
    // not permission to see something.
    const secret = makeTeammate({
      id: "secret",
      visibility: "private",
      ownerId: "someone-else",
    });
    expect(
      rosterTeammates([secret], { userId: "nobody", role: "viewer" }, [])
    ).toEqual([]);
  });
});
