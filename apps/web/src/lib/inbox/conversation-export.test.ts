import { describe, expect, it } from "vitest";
import { parseAgenticTrace } from "@agent-hub/core";
import type { InboxConversation, StoredMessage } from "@agent-hub/core";
import {
  conversationExportRows,
  messageContent,
  type ConversationExportRow,
} from "./conversation-export";

/**
 * The reference-parity Inbox export (#561). The contract under test is
 * literal: 29 named fields in the reference's own spelling, empty strings for
 * anything absent, and `Messages[]` items carrying exactly five fields, because
 * a parser written against a reference export file has to read ours unchanged.
 */

/** Exactly the reference's 29 field names, in its own order. */
const REFERENCE_FIELDS = [
  "Conversation ID",
  "User Name",
  "User Email",
  "User Role",
  "Student ID",
  "Assistant ID",
  "Assistant Name",
  "Course ID",
  "Course Name",
  "Date",
  "Messages Count",
  "Positive Feedback Count",
  "Negative Feedback Count",
  "Escalation Status",
  "Escalation Help Desk",
  "Escalation Option",
  "Session Launch URL",
  "IP Address",
  "Browser",
  "OS",
  "Resolution",
  "Language",
  "Country Code",
  "City",
  "CSAT Score",
  "CSAT Comment",
  "External User Data",
  "External User Data Source Names",
  "Messages",
];

function conversation(
  overrides: Partial<InboxConversation> = {}
): InboxConversation {
  return {
    id: "c-1",
    assistantId: "as-1",
    subjectType: "visitor",
    subjectId: "v-1",
    collectionId: null,
    title: "Where are the videos?",
    metadata: { userName: "Ada", userEmail: "ada@example.edu", userRole: "Learner" },
    sessionState: {},
    pinned: false,
    createdAt: "2026-07-01T09:00:00Z",
    updatedAt: "2026-07-01T09:05:00Z",
    assistantTitle: "Campus Assistant",
    collectionName: null,
    messageCount: 2,
    flowNames: ["Default Behavior"],
    notificationOnly: false,
    feedback: 0,
    ...overrides,
  };
}

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "m-1",
    conversationId: "c-1",
    role: "assistant",
    content: [],
    flowId: "f-1",
    flowName: "Default Behavior",
    feedback: 0,
    trace: null,
    createdAt: "2026-07-01T09:00:05Z",
    ...overrides,
  };
}

const answer = message({
  id: "m-2",
  role: "assistant",
  feedback: 1,
  content: [
    {
      type: "progress",
      action: "search_knowledge",
      text: "Sto cercando i video nella sezione Video Prova del corso…",
    },
    { type: "text", action: "search_knowledge", text: "Sono in Materiali." },
    {
      type: "sources",
      action: "search_knowledge",
      sources: [
        {
          conceptId: "k1",
          conceptTitle: "Video Prova",
          collectionName: "MARKETING (A)",
          sourceName: "Lecture 3.pdf",
          url: null,
        },
      ],
    },
    { type: "follow_ups", action: "follow_up_questions", questions: ["E gli esami?"] },
  ],
  trace: {
    searchCount: 1,
    truncated: false,
    steps: [
      { id: "t1", kind: "thought", label: "Cercano i video del corso.", status: "done" },
      {
        id: "c1",
        kind: "tool",
        tool: "searchKnowledge",
        label: "Searching knowledge for “video prova”",
        status: "done",
        detail: "Found 1 relevant concept",
        iteration: 1,
      },
    ],
  },
});

const rowFor = (
  overrides: Partial<InboxConversation> = {},
  messages: StoredMessage[] = [message({ role: "user", content: [{ type: "text", text: "Dove?" }] }), answer]
): ConversationExportRow =>
  conversationExportRows(
    [{ conversation: conversation(overrides), messages }],
    { includeReasoning: true, iterationLimit: 6 }
  )[0];

describe("conversationExportRows", () => {
  it("emits exactly the reference's 29 fields, in its order", () => {
    expect(Object.keys(rowFor())).toEqual(REFERENCE_FIELDS);
  });

  it("exports a field with no producing feature as an empty string", () => {
    const row = rowFor();
    // LMS course anchoring and the CSAT survey do not exist yet: the shape is
    // right, the data fills in when they land.
    for (const field of [
      "Student ID",
      "Course ID",
      "Course Name",
      "CSAT Score",
      "CSAT Comment",
      "External User Data",
      "External User Data Source Names",
      "Escalation Status",
    ] as const) {
      expect(row[field]).toBe("");
    }
    expect(Object.values(row).some((v) => v === null)).toBe(false);
  });

  it("carries the fields whose producing feature does exist", () => {
    const row = rowFor({
      metadata: {
        userName: "Ada",
        userEmail: "ada@example.edu",
        userRole: "Learner",
        escalated: true,
        escalationHelpDesk: "IT Service Desk",
        escalationOption: "Email us",
        launchUrl: "https://lms.example.edu/course/1818",
        ip: "203.0.113.7",
        browser: "Chrome",
        os: "macOS",
        resolution: "1470x923",
        language: "it",
        location: "IT",
        city: "Rome",
        externalUserData: { programme: "MSc Marketing" },
        externalUserDataSourceNames: ["students.csv"],
      },
    });
    expect(row["Escalation Status"]).toBe("Escalated");
    expect(row["Escalation Help Desk"]).toBe("IT Service Desk");
    expect(row["Escalation Option"]).toBe("Email us");
    expect(row["Country Code"]).toBe("IT");
    expect(row["External User Data"]).toBe('{"programme":"MSc Marketing"}');
    expect(row["External User Data Source Names"]).toBe("students.csv");
  });

  it("counts messages and per-message votes", () => {
    const row = rowFor({}, [
      message({ id: "a", role: "user", content: [{ type: "text", text: "?" }] }),
      message({ id: "b", feedback: 1 }),
      message({ id: "c", feedback: -1 }),
      message({ id: "d", feedback: 0 }),
    ]);
    expect(row["Messages Count"]).toBe(4);
    expect(row["Positive Feedback Count"]).toBe(1);
    expect(row["Negative Feedback Count"]).toBe(1);
  });

  it("gives each Messages[] item exactly the five reference fields", () => {
    const row = rowFor();
    for (const item of row.Messages) {
      expect(Object.keys(item)).toEqual([
        "Sender",
        "Timestamp",
        "Content",
        "Feedback",
        "AgenticTrace",
      ]);
    }
    expect(row.Messages[0].Sender).toBe("User");
    expect(row.Messages[1].Sender).toBe("Assistant");
    // Feedback is the reference's string form, null when never rated.
    expect(row.Messages[1].Feedback).toBe("positive");
    expect(row.Messages[0].Feedback).toBeNull();
    // A user message has no trace to serialize.
    expect(row.Messages[0].AgenticTrace).toBe("");
  });

  it("serializes the assistant turn's trace into the flat bracketed string", () => {
    const trace = rowFor().Messages[1].AgenticTrace;
    expect(parseAgenticTrace(trace).map((s) => s.marker)).toEqual([
      "workflow_started",
      "thinking",
      "tool",
      "result",
      "suggested_questions",
      "workflow_completed",
    ]);
    expect(trace).toContain("[Workflow started: Default Behavior]");
    expect(trace).toContain("[Suggested questions: E gli esami?]");
    expect(trace).toContain("You are now at iteration 1 out of 6.");
  });

  it("withholds reasoning below the visibility gate", () => {
    const [row] = conversationExportRows(
      [{ conversation: conversation(), messages: [answer] }],
      { includeReasoning: false, iterationLimit: 6 }
    );
    expect(row.Messages[0].AgenticTrace).not.toContain("[Thinking:");
    expect(row.Messages[0].AgenticTrace).toContain("[Tool:");
  });

  it("exports a Conversation with no assistant turns", () => {
    const row = rowFor({}, [
      message({ role: "user", content: [{ type: "text", text: "Dove?" }] }),
    ]);
    expect(row.Messages).toHaveLength(1);
    expect(row.Messages[0].AgenticTrace).toBe("");
  });

  it("exports a Notification-only Conversation", () => {
    const row = rowFor({ notificationOnly: true }, [
      message({
        content: [
          {
            type: "notification",
            action: "notification",
            title: "Enrolment closes Friday",
            content: "Submit your form before 17:00.",
          },
        ],
        flowName: "Enrolment nudge",
      }),
    ]);
    expect(row.Messages[0].Content).toBe(
      "Enrolment closes Friday\nSubmit your form before 17:00."
    );
    // A verbatim Notification did no agentic work, so there are no steps, only
    // the workflow brackets around it.
    expect(row.Messages[0].AgenticTrace).toBe(
      "[Workflow started: Enrolment nudge] [Workflow completed: Enrolment nudge]"
    );
  });
});

describe("messageContent", () => {
  it("joins the narration and the answer with the reference's separator", () => {
    expect(
      messageContent([
        { type: "progress", action: "search_knowledge", text: "Sto cercando i video…" },
        { type: "progress", action: "search_knowledge", text: "Provo con l'LMS..." },
        { type: "text", action: "search_knowledge", text: "Mi dispiace, ma…" },
      ])
    ).toBe("Sto cercando i video...Provo con l'LMS...Mi dispiace, ma…");
  });

  it("appends one inline source marker per citation", () => {
    const content = messageContent([
      { type: "text", action: "search_knowledge", text: "Sono in Materiali." },
      {
        type: "sources",
        action: "search_knowledge",
        sources: [
          {
            conceptTitle: "Video Prova",
            collectionName: "MARKETING (A)",
            sourceName: "Lecture 3.pdf",
          },
          // A citation with no file behind it names the Concept instead of
          // inventing a filename (an FAQ, a live API result).
          {
            conceptTitle: "Moodle Course Modules",
            collectionName: "Moodle",
            sourceName: null,
          },
        ],
      },
    ]);
    expect(content).toContain("[Source: MARKETING (A) - Lecture 3.pdf]");
    expect(content).toContain("[Source: Moodle - Moodle Course Modules]");
    // The Source *type* is never guessed: a citation carries a name, not a kind,
    // so a crawled website must not be filed under "Files".
    expect(content).not.toContain("Files:");
  });

  it("skips parts with nothing to say and tolerates malformed ones", () => {
    expect(messageContent([])).toBe("");
  });

  it("flattens a rendered component into the answer's Content", () => {
    // Generative UI: the answer refers to the table, so the export has to carry
    // the table. Joined with the same `...` the narration lines use.
    const content = messageContent([
      {
        type: "component",
        action: "search_knowledge",
        name: "table",
        callId: "call-1",
        props: { columns: ["Piano", "Prezzo"], rows: [["Pro", "29"]] },
      },
      { type: "text", action: "search_knowledge", text: "Come vedi in tabella." },
    ]);
    expect(content).toBe("Piano | Prezzo\nPro | 29...Come vedi in tabella.");
    expect(
      messageContent([
        null,
        { type: "text", action: "search_knowledge", text: "   " },
        { type: "button", action: "show_button", label: "Open", buttonType: "external_link" },
      ])
    ).toBe("");
  });
});
