import { describe, expect, it } from "vitest";
import type { InboxConversation } from "@agent-hub/core";
import {
  defaultInboxFilters,
  inboxQueryFromFilters,
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
