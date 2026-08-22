import { describe, expect, it } from "vitest";
import type { InboxConversation } from "@agent-hub/core";
import {
  defaultInboxFilters,
  filterConversations,
  subjectName,
  type InboxFilterCriteria,
} from "./conversation-filter";

function conversation(over: Partial<InboxConversation> = {}): InboxConversation {
  return {
    id: "c1",
    assistantId: "a1",
    subjectType: "visitor",
    subjectId: "v1",
    collectionId: null,
    title: "Refund policy",
    metadata: {},
    sessionState: {},
    pinned: false,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
    assistantTitle: "Support",
    collectionName: null,
    messageCount: 4,
    flowNames: [],
    notificationOnly: false,
    feedback: 0,
    ...over,
  };
}

/** Wide-open criteria: every clause disabled, staff included. */
function openFilters(
  over: Partial<InboxFilterCriteria> = {}
): InboxFilterCriteria {
  return {
    ...defaultInboxFilters(),
    search: "",
    from: "",
    to: "",
    staff: "include",
    ...over,
  };
}

describe("filterConversations", () => {
  it("passes everything through open filters", () => {
    const list = [conversation(), conversation({ id: "c2" })];
    expect(filterConversations(list, openFilters())).toHaveLength(2);
  });

  it("applies the date range on updatedAt, inclusive of the To day", () => {
    const list = [
      conversation({ id: "early", updatedAt: "2026-08-01T09:00:00.000Z" }),
      conversation({ id: "inside", updatedAt: "2026-08-10T09:00:00.000Z" }),
      conversation({ id: "late", updatedAt: "2026-08-21T09:00:00.000Z" }),
    ];
    const out = filterConversations(list, openFilters({ from: "2026-08-05", to: "2026-08-10" }));
    expect(out.map((c) => c.id)).toEqual(["inside"]);
  });

  it("searches title, user fields and the derived subject name", () => {
    const list = [
      conversation({ id: "byTitle", title: "Shipping delays" }),
      conversation({ id: "byEmail", metadata: { userEmail: "ada@example.com" } }),
      conversation({ id: "byName", metadata: { userName: "Grace Hopper" } }),
      conversation({ id: "miss", title: "Other" }),
    ];
    const at = (needle: string) =>
      filterConversations(list, openFilters({ search: needle })).map((c) => c.id);
    expect(at("shipping")).toEqual(["byTitle"]);
    expect(at("ada@")).toEqual(["byEmail"]);
    expect(at("hopper")).toEqual(["byName"]);
    // "Visitor" is the fallback subject name for anonymous conversations;
    // byEmail and byName derive a real name instead, so they don't match.
    expect(at("visitor")).toEqual(["byTitle", "miss"]);
  });

  it("searches user info across email, name, role and subject id", () => {
    const list = [
      conversation({ id: "byRole", metadata: { userRole: "staff-mentor" } }),
      conversation({ id: "bySubject", subjectId: "vis-42" }),
      conversation({ id: "miss" }),
    ];
    const at = (userInfo: string) =>
      filterConversations(list, openFilters({ userInfo })).map((c) => c.id);
    expect(at("mentor")).toEqual(["byRole"]);
    expect(at("vis-42")).toEqual(["bySubject"]);
  });

  it("hides staff (member-subject) conversations by default (#668)", () => {
    const list = [
      conversation({ id: "visitor" }),
      conversation({ id: "staff", subjectType: "member" }),
    ];
    const defaults = openFilters({ staff: "" });
    expect(filterConversations(list, defaults).map((c) => c.id)).toEqual([
      "visitor",
    ]);
    const only = openFilters({ staff: "only" });
    expect(filterConversations(list, only).map((c) => c.id)).toEqual(["staff"]);
    const include = openFilters({ staff: "include" });
    expect(filterConversations(list, include)).toHaveLength(2);
  });

  it("applies the equality filters", () => {
    const list = [
      conversation({
        id: "match",
        assistantId: "a2",
        metadata: { location: "IT", city: "Rome", userRole: "student", language: "it" },
        flowNames: ["Refunds"],
      }),
      conversation({ id: "miss" }),
    ];
    const cases: Array<Partial<InboxFilterCriteria>> = [
      { location: "IT" },
      { city: "Rome" },
      { role: "student" },
      { assistantId: "a2" },
      { language: "it" },
      { workflow: "Refunds" },
    ];
    for (const over of cases) {
      const out = filterConversations(list, openFilters(over));
      expect(out.map((c) => c.id)).toEqual(["match"]);
    }
  });

  it("honors the conversation-id allowlist, split on commas and whitespace", () => {
    const list = [
      conversation({ id: "keep-1" }),
      conversation({ id: "keep-2" }),
      conversation({ id: "drop" }),
    ];
    const out = filterConversations(list, openFilters({ conversationIds: "keep-1, keep-2\n" }));
    expect(out.map((c) => c.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("filters by feedback sign and escalation state", () => {
    const list = [
      conversation({ id: "up", feedback: 1 }),
      conversation({ id: "down", feedback: -1 }),
      conversation({ id: "esc", metadata: { escalated: true } }),
    ];
    expect(
      filterConversations(list, openFilters({ feedback: "up" })).map((c) => c.id)
    ).toEqual(["up"]);
    expect(
      filterConversations(list, openFilters({ feedback: "down" })).map((c) => c.id)
    ).toEqual(["down"]);
    expect(
      filterConversations(list, openFilters({ escalation: "escalated" })).map(
        (c) => c.id
      )
    ).toEqual(["esc"]);
    expect(
      filterConversations(list, openFilters({ escalation: "not_escalated" })).map(
        (c) => c.id
      )
    ).toEqual(["up", "down"]);
  });
});

describe("subjectName", () => {
  it("prefers name, then email local part, then SSO claim, then the subject kind", () => {
    expect(subjectName(conversation({ metadata: { userName: "Ada" } }))).toBe("Ada");
    expect(
      subjectName(conversation({ metadata: { userEmail: "ada@example.com" } }))
    ).toBe("ada");
    expect(
      subjectName(conversation({ metadata: { ssoClaimValue: "ada@idp" } }))
    ).toBe("ada@idp");
    expect(subjectName(conversation({ subjectType: "member" }))).toBe("Member");
    expect(subjectName(conversation({ subjectType: "sso" }))).toBe("Signed-in user");
    expect(subjectName(conversation())).toBe("Visitor");
  });
});
