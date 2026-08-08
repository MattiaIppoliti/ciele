import type {
  Assistant,
  ConversationFilter,
  InboxConversation,
  InsightsFilter,
  InsightsMessage,
  OrgWebsiteSource,
} from "../types";

/**
 * Shared Insights test fixtures (PRD #270, slice #272).
 *
 * One input source consumed by both the pure-TS oracle test (`insights.test.ts`)
 * and the SQL parity test (`insights.parity.test.ts`), so neither implementation
 * can be verified against inputs the other never saw.
 */

let seq = 0;

export function conv(overrides: Partial<InboxConversation> = {}): InboxConversation {
  seq += 1;
  return {
    id: `c${seq}`,
    assistantId: "a1",
    subjectType: "visitor",
    subjectId: `visitor-${seq}`,
    collectionId: null,
    collectionName: null,
    title: "",
    metadata: {},
    pinned: false,
    createdAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-06-15T12:00:00.000Z",
    assistantTitle: "A1",
    messageCount: 0,
    flowNames: [],
    notificationOnly: false,
    feedback: 0,
    ...overrides,
  } as InboxConversation;
}

export function msg(overrides: Partial<InsightsMessage> = {}): InsightsMessage {
  return {
    conversationId: "c1",
    role: "assistant",
    feedback: 0,
    createdAt: "2026-06-15T12:00:00.000Z",
    proactive: false,
    ...overrides,
  };
}

export const NO_FILTER: ConversationFilter = {
  from: "",
  to: "",
  assistantId: "",
  channel: "",
  role: "",
  feedback: "",
  escalation: "",
};

export const ASSISTANTS: Pick<Assistant, "id" | "title">[] = [
  { id: "a1", title: "Helper One" },
  { id: "a2", title: "Helper Two" },
];

export const CHANNELS: OrgWebsiteSource[] = [
  { id: "s1", assistantId: "a1", name: "Campus Portal", url: "https://www.campus.edu" },
  { id: "s2", assistantId: "a2", name: "Library", url: "https://library.uni.it/" },
];

/** A spread of conversations across dates, assistants, channels, roles. */
export function fixtureConversations(): InboxConversation[] {
  seq = 0;
  return [
    // Staff conversation (admin Preview / data assistant, #668): both
    // implementations must exclude it from every aggregate.
    conv({
      assistantId: "a1",
      subjectType: "member",
      subjectId: "staff-1",
      createdAt: "2026-06-02T10:00:00.000Z",
      metadata: { userRole: "student", language: "en" },
      feedback: 1,
    }),
    conv({
      assistantId: "a1",
      subjectId: "u1",
      createdAt: "2026-06-02T09:00:00.000Z",
      metadata: {
        launchUrl: "https://www.campus.edu/a",
        userRole: "student",
        language: "en",
        userEmail: "u1@uni.it",
      },
      feedback: 1,
    }),
    conv({
      assistantId: "a1",
      subjectId: "u2",
      createdAt: "2026-06-02T18:00:00.000Z",
      metadata: {
        launchUrl: "https://www.campus.edu/b",
        userRole: "student",
        language: "en",
        escalated: true,
      },
      feedback: -1,
    }),
    conv({
      assistantId: "a2",
      subjectId: "u3",
      createdAt: "2026-06-05T11:00:00.000Z",
      metadata: {
        launchUrl: "https://library.uni.it/x",
        userRole: "staff",
        language: "it",
      },
    }),
    conv({
      assistantId: "a2",
      subjectId: "u1",
      createdAt: "2026-06-09T14:00:00.000Z",
      metadata: { userRole: "staff", language: "it", userEmail: "u1@uni.it" },
    }),
    conv({
      assistantId: "a1",
      subjectId: "u4",
      createdAt: "2026-06-09T15:00:00.000Z",
      metadata: {
        launchUrl: "https://library.uni.it/y",
        userRole: "student",
        language: "fr",
        escalated: true,
      },
    }),
    // #546 coverage, in the shared fixture so both implementations must agree:
    // a conversation the visitor joined after a nudge (counts, but the nudge is
    // not an answer), and one that never got past the nudge (counts as nothing).
    conv({
      assistantId: "a1",
      subjectId: "u5",
      createdAt: "2026-06-11T10:00:00.000Z",
      metadata: { userRole: "student", language: "en" },
      notificationOnly: false,
    }),
    conv({
      assistantId: "a2",
      subjectId: "u6",
      createdAt: "2026-06-12T10:00:00.000Z",
      metadata: { userRole: "guest", language: "es" },
      notificationOnly: true,
    }),
  ];
}

export function fixtureMessages(convs: InboxConversation[]): InsightsMessage[] {
  const out: InsightsMessage[] = [];
  for (const c of convs) {
    // A notification-only conversation is exactly that: one proactive message and
    // nothing else. The others get a nudge *and* a real exchange, so the two rules
    // (not-an-answer, and not-a-conversation) are exercised independently.
    if (c.notificationOnly) {
      out.push(
        msg({
          conversationId: c.id,
          role: "assistant",
          feedback: 0,
          createdAt: c.createdAt,
          proactive: true,
        })
      );
      continue;
    }
    if (c.subjectId === "u5") {
      out.push(
        msg({
          conversationId: c.id,
          role: "assistant",
          feedback: 0,
          createdAt: c.createdAt,
          proactive: true,
        })
      );
    }
    out.push(msg({ conversationId: c.id, role: "user", feedback: 0, createdAt: c.createdAt }));
    out.push(
      msg({
        conversationId: c.id,
        role: "assistant",
        feedback: c.feedback,
        createdAt: c.createdAt,
      })
    );
  }
  return out;
}

export const FILTER_CASES: InsightsFilter[] = [
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "weekly", assistantId: "", channel: "", role: "", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "monthly", assistantId: "", channel: "", role: "", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "a1", channel: "", role: "", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "campus.edu", role: "", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "student", feedback: "", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "up", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "down", escalation: "" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "", escalation: "escalated" },
  { from: "2026-06-01", to: "2026-06-30", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "", escalation: "not_escalated" },
  { from: "2026-06-03", to: "2026-06-08", aggregate: "daily", assistantId: "", channel: "", role: "", feedback: "", escalation: "" },
];
