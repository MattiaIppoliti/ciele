import { describe, expect, it } from "vitest";
import {
  isReferredConversation,
  referralCandidates,
  referralContextSection,
  referralPromptSection,
  standingContextSections,
} from "./referral";
import type { Teammate } from "./types";

/**
 * Who a Teammate may hand a request to (#773).
 *
 * The rule carrying the weight is the one about private Teammates: a
 * suggestion naming one would disclose that it exists, which is the same leak
 * `canViewTeammate` refuses by answering `not_found` rather than "forbidden".
 * Most of these cases are that rule from a different angle.
 */

const teammate = (over: Partial<Teammate> = {}): Teammate => ({
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
  systemKind: null,
  assistantId: null,
  approvalBypass: false,
  projectId: null,
  deletedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const viewer = { userId: "member-owner", role: "editor" as const };
const origin = teammate({ id: "tm-origin", name: "Origin" });

describe("referralCandidates", () => {
  it("offers the org's other Teammates, with something to choose on", () => {
    const candidates = referralCandidates(
      [origin, teammate({ id: "tm-2", name: "Ada", title: "Data Analyst" })],
      origin,
      viewer
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("Ada");
    // Title plus role: a model picking between colleagues on names alone picks
    // the first one.
    expect(candidates[0].description).toContain("Data Analyst");
    expect(candidates[0].description).toContain("draft replies");
  });

  it("never names a private Teammate, even to somebody who owns it", () => {
    // The owner can open it themselves. What they must not get is an agent
    // volunteering its existence into a transcript they might forward.
    const secret = teammate({
      id: "tm-secret",
      name: "Secret",
      visibility: "private",
      ownerId: viewer.userId,
    });
    expect(referralCandidates([origin, secret], origin, viewer)).toEqual([]);
  });

  it("never names one the Member cannot see", () => {
    const someoneElses = teammate({
      id: "tm-theirs",
      name: "Theirs",
      visibility: "private",
      ownerId: "another-member",
    });
    expect(
      referralCandidates([origin, someoneElses], origin, {
        userId: "a-third-member",
        role: "viewer",
      })
    ).toEqual([]);
  });

  it("excludes itself and anything retired", () => {
    const retired = teammate({
      id: "tm-gone",
      name: "Gone",
      deletedAt: "2026-08-10T00:00:00.000Z",
    });
    // "Ask me" is not a referral, and a card nobody can open is a dead end.
    expect(referralCandidates([origin, retired], origin, viewer)).toEqual([]);
  });

  it("describes a Teammate nobody has briefed yet", () => {
    const blank = teammate({ id: "tm-blank", title: "", roleDescription: "" });
    expect(
      referralCandidates([origin, blank], origin, viewer)[0].description
    ).toBe("No role described yet");
  });
});

describe("referralPromptSection", () => {
  it("is null when there is nobody to refer to", () => {
    // The tool is then never registered. A model holding one it can never
    // usefully call reaches for it anyway, and a one-Teammate organization
    // would get "let me hand you to..." with nowhere to go.
    expect(referralPromptSection([])).toBeNull();
  });

  it("lists the colleagues and says when not to use them", () => {
    const section = referralPromptSection([
      { id: "tm-2", name: "Ada", description: "Data Analyst" },
    ]);
    expect(section).toContain("Ada: Data Analyst");
    expect(section).toContain("Do not refer for something you can do yourself");
  });
});

describe("referralContextSection", () => {
  it("is null without a summary, so an ordinary chat reads nothing", () => {
    expect(referralContextSection(null)).toBeNull();
    expect(referralContextSection({})).toBeNull();
    expect(referralContextSection({ referralSummary: "   " })).toBeNull();
  });

  it("attributes the summary to the referring Teammate, not to the Member", () => {
    const section = referralContextSection({
      referredFromTeammateName: "Nora",
      referralSummary: "They are migrating a mailbox and hit a quota error.",
    });
    // Saying the Member wrote this would be false, and the sort of false that
    // gets quoted back at them.
    expect(section).toContain("Nora, another teammate here, referred");
    expect(section).toContain("not what the colleague said");
    expect(section).toContain("quota error");
    expect(section).toContain("Do not make them repeat themselves");
  });

  it("still reads when the referring Teammate has since been deleted", () => {
    const section = referralContextSection({
      referralSummary: "They hit a quota error.",
    });
    expect(section).toContain("Another teammate referred");
  });
});

describe("isReferredConversation", () => {
  it("is true only for a conversation that began as a handoff", () => {
    expect(
      isReferredConversation({ referredFromConversationId: "c-1" })
    ).toBe(true);
    expect(isReferredConversation({})).toBe(false);
    expect(isReferredConversation(null)).toBe(false);
  });
});

describe("standingContextSections", () => {
  it("keeps the referral summary whole instead of one entry per character", () => {
    const sections = standingContextSections(["# What you remember\nA note."], {
      referredFromTeammateName: "Nora",
      referralSummary: "They are migrating a mailbox and hit a quota error.",
    });
    // The bug this exists to catch: the section arrives as a string, and
    // spreading a string into the list splits it into characters, so the model
    // reads the summary one letter per paragraph.
    expect(sections).toHaveLength(2);
    expect(sections[1]).toContain("quota error");
    expect(sections.every((section) => section.length > 1)).toBe(true);
  });

  it("is the memory layers alone when the conversation is not a referral", () => {
    const memory = ["# What you remember\nA note."];
    expect(standingContextSections(memory, {})).toEqual(memory);
    expect(standingContextSections(memory, null)).toEqual(memory);
  });

  it("is the referral alone when there is no memory to read", () => {
    const sections = standingContextSections([], {
      referralSummary: "They hit a quota error.",
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain("Another teammate referred");
  });
});
