import { describe, expect, it } from "vitest";
import type { InboxConversation } from "@agent-hub/core";
import {
  defaultInboxFilters,
  inboxQueryFromFilters,
  inboxUrlStateFromSearchParams,
  subjectName,
  type InboxFilterCriteria,
} from "./conversation-filter";

function conversation(over: Partial<InboxConversation> = {}): InboxConversation {
  return {
    id: "c1",
    assistantId: "a1",
    teammateId: null,
    subjectType: "visitor",
    subjectId: "v1",
    collectionId: null,
    title: "Refund policy",
    metadata: {},
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

describe("inboxQueryFromFilters", () => {
  it("serializes the UI filters for the bounded server read", () => {
    expect(
      inboxQueryFromFilters(
        openFilters({
          search: "  refund ",
          assistantId: "a2",
          conversationIds: "c1, c2\n",
        }),
        { cursor: "opaque", limit: 25 }
      )
    ).toEqual(
      expect.objectContaining({
        search: "refund",
        assistantId: "a2",
        conversationIds: ["c1", "c2"],
        cursor: "opaque",
        limit: 25,
      })
    );
  });
});

describe("inboxUrlStateFromSearchParams", () => {
  it("opens on the defaults with no search when the URL carries nothing", () => {
    expect(inboxUrlStateFromSearchParams({})).toEqual({
      ...defaultInboxFilters(),
      q: "",
    });
  });

  it("reads the filters and the search a shared link carries", () => {
    const state = inboxUrlStateFromSearchParams(
      new URLSearchParams("escalation=escalated&feedback=down&q=refund&from=2026-01-01"),
    );
    expect(state.escalation).toBe("escalated");
    expect(state.feedback).toBe("down");
    expect(state.q).toBe("refund");
    expect(state.from).toBe("2026-01-01");
  });

  it("keeps a typed filter at its default when the link holds an impossible value", () => {
    const state = inboxUrlStateFromSearchParams({ staff: "everyone", review: "maybe" });
    expect(state.staff).toBe("");
    expect(state.review).toBe("");
  });
});
