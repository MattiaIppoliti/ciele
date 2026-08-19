import { describe, expect, it } from "vitest";
import type { InboxConversation, StoredMessage } from "@agent-hub/core";
import { escapeHtml, transcriptDocument } from "./transcript-print";

/**
 * The printable transcript document (#561). The requirement worth a test is that
 * a long transcript is not truncated, every turn reaches the document, and the
 * browser paginates, plus that transcript text can never inject markup into it.
 */

const conversation: InboxConversation = {
  id: "c-1",
  assistantId: "as-1",
  subjectType: "visitor",
  subjectId: "v-1",
  collectionId: null,
  title: "Where are the videos?",
  metadata: {
    userName: "Ada",
    userRole: "Learner",
    escalated: true,
    escalationHelpDesk: "IT Service Desk",
    escalationOption: "Email us",
  },
  sessionState: {},
  pinned: false,
  createdAt: "2026-07-01T09:00:00Z",
  updatedAt: "2026-07-01T09:05:00Z",
  assistantTitle: "Campus Assistant",
  collectionName: "MARKETING (A)",
  messageCount: 2,
  flowNames: ["Default Behavior"],
  notificationOnly: false,
  feedback: 0,
};

function message(i: number, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: `m-${i}`,
    conversationId: "c-1",
    role: i % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", action: "search_knowledge", text: `Turn ${i}` }],
    flowId: "f-1",
    flowName: "Default Behavior",
    feedback: 0,
    trace: null,
    createdAt: `2026-07-01T09:00:0${i % 10}Z`,
    ...overrides,
  };
}

describe("transcriptDocument", () => {
  it("includes every turn of a long transcript", () => {
    const messages = Array.from({ length: 400 }, (_, i) => message(i));
    const doc = transcriptDocument({ conversation, messages });
    expect(doc.match(/class="turn /g)).toHaveLength(400);
    expect(doc).toContain("Turn 0");
    expect(doc).toContain("Turn 399");
    expect(doc).toContain("400 messages");
  });

  it("carries the conversation's own details", () => {
    const doc = transcriptDocument({
      conversation,
      messages: [message(1)],
      organizationName: "Example University",
    });
    expect(doc).toContain("Where are the videos?");
    expect(doc).toContain("Campus Assistant");
    expect(doc).toContain("MARKETING (A)");
    expect(doc).toContain("IT Service Desk · Email us");
    expect(doc).toContain("Example University");
    expect(doc).toContain("Workflow: Default Behavior");
  });

  it("records a vote and marks a turn with no renderable text", () => {
    const doc = transcriptDocument({
      conversation,
      messages: [
        message(1, { feedback: -1 }),
        message(3, {
          content: [
            { type: "button", action: "show_button", label: "Open", buttonType: "external_link" },
          ],
        }),
      ],
    });
    expect(doc).toContain("Rated not helpful");
    expect(doc).toContain("(no text content)");
  });

  it("escapes transcript text rather than embedding it as markup", () => {
    const doc = transcriptDocument({
      conversation: { ...conversation, title: '<script>alert("x")</script>' },
      messages: [
        message(1, {
          content: [
            {
              type: "text",
              action: "search_knowledge",
              text: "<img src=x onerror=alert(1)>",
            },
          ],
        }),
      ],
    });
    expect(doc).not.toContain("<script>alert");
    expect(doc).not.toContain("<img src=x");
    expect(doc).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("is a complete standalone document", () => {
    const doc = transcriptDocument({ conversation, messages: [] });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc.trimEnd().endsWith("</html>")).toBe(true);
    // No external references: printing must not depend on the network.
    expect(doc).not.toMatch(/<(link|script)\b/);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could break out of text or an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });
});
