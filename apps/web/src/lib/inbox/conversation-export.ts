import type { InboxConversation, StoredMessage } from "@agent-hub/core";
import { serializeAgenticTrace } from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";
import { componentPartText } from "@agent-hub/agent/client";

/**
 * The Inbox JSON export, at reference parity (#561): one object per Conversation
 * with the reference platform's 29 fields, the last of which is a `Messages[]`
 * array whose items carry exactly `Sender`, `Timestamp`, `Content`, `Feedback` and
 * `AgenticTrace`. A parser written against a reference export file reads ours
 * unchanged; that is the whole requirement, and it is why the field *names* are
 * the reference's strings rather than our camelCase domain names.
 *
 * Two deliberate consequences:
 *
 * - **Everything is a string, and an absent value is `""`**: never `null`, never
 *   a missing key. A field whose producing feature has not shipped (LMS course
 *   anchoring, the CSAT survey) exports empty, which is exactly what the reference
 *   does for a tenant that does not use it, so the shape is right today and the
 *   data fills in when the feature lands.
 * - **`Content` is flattened here, not stored flat.** The reference glues the
 *   Simplified-thinking narration, the answer, and inline `[Source: …]` markers
 *   into one string; we keep them as separate reply parts and concatenate only on
 *   the way out (see {@link messageContent}).
 *
 * Pure and synchronous on purpose: the caller fetches, this shapes, and the shape
 * is testable without a database.
 */

/**
 * Conversations one export may carry. An export reads every selected
 * Conversation's whole transcript, so the ceiling exists to keep one click from
 * turning into thousands of message reads. Lives here rather than beside the
 * server action because a `"use server"` module may only export async functions.
 */
export const INBOX_EXPORT_MAX_CONVERSATIONS = 500;

/**
 * Transcript reads issued at once while assembling an export. Fanning all 500 out
 * concurrently would make a single click a load spike on the tenant's own
 * database; batching trades a little wall-clock for not doing that.
 */
export const INBOX_EXPORT_READ_BATCH = 20;

/** One `Messages[]` item, exactly the reference's five fields. */
export interface ConversationExportMessage {
  Sender: "User" | "Assistant";
  Timestamp: string;
  Content: string;
  /** The reference's string form, or null when the answer was never rated. */
  Feedback: "positive" | "negative" | null;
  AgenticTrace: string;
}

/** One exported Conversation, the reference's 29-field record. */
export interface ConversationExportRow {
  "Conversation ID": string;
  "User Name": string;
  "User Email": string;
  "User Role": string;
  "Student ID": string;
  "Assistant ID": string;
  "Assistant Name": string;
  "Course ID": string;
  "Course Name": string;
  Date: string;
  "Messages Count": number;
  "Positive Feedback Count": number;
  "Negative Feedback Count": number;
  "Escalation Status": string;
  "Escalation Help Desk": string;
  "Escalation Option": string;
  "Session Launch URL": string;
  "IP Address": string;
  Browser: string;
  OS: string;
  Resolution: string;
  Language: string;
  "Country Code": string;
  City: string;
  "CSAT Score": string;
  "CSAT Comment": string;
  "External User Data": string;
  "External User Data Source Names": string;
  Messages: ConversationExportMessage[];
}

/** A Conversation plus the transcript to export with it. */
export interface ConversationExportInput {
  conversation: InboxConversation;
  messages: StoredMessage[];
}

export interface ConversationExportOptions {
  /**
   * Whether the exporting Member may read the model's own reasoning (#557). False
   * drops every `[Thinking:]` segment from `AgenticTrace` and keeps the tool
   * timeline, the same gate the transcript panel applies, enforced here too
   * because an export leaves the console.
   */
  includeReasoning: boolean;
  /** Agent-loop budget quoted in each result's `[System note]`. */
  iterationLimit?: number;
}

/** Empty string for anything absent, never null, never a missing key. */
function str(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The reference's `Content`: the Simplified-thinking narration lines and the
 * answer text joined with `...`, then one inline `[Source: …]` marker per
 * citation appended at the end.
 *
 * A narration line that already ends in its own ellipsis has it trimmed first, so
 * the joiner reads the way the reference's does rather than as `…...`.
 */
export function messageContent(content: readonly unknown[]): string {
  const parts = content as ChatReplyPart[];
  const chunks: string[] = [];
  const sources: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "progress") {
      const line = part.text.trim().replace(/[.…]+$/, "");
      if (line) chunks.push(line);
    } else if (part.type === "text") {
      if (part.text.trim()) chunks.push(part.text.trim());
    } else if (part.type === "notification") {
      const title = part.title?.trim();
      chunks.push([title, part.content.trim()].filter(Boolean).join("\n"));
    } else if (part.type === "clarify") {
      if (part.question.trim()) chunks.push(part.question.trim());
    } else if (part.type === "component") {
      // A rendered component is content: flattened, an export consumer sees the
      // rows rather than prose referring to a table that is not there.
      const text = componentPartText(part);
      if (text) chunks.push(text);
    } else if (part.type === "sources") {
      for (const source of part.sources) {
        // `Collection - SourceName`, following the reference's
        // `Collection - SourceType: SourceName` shape minus the type. The type is
        // deliberately omitted rather than guessed: a citation carries the Source's
        // *name*, not its kind, so labelling everything `Files:` would file a
        // crawled website or an FAQ Concept under the wrong type. A citation with
        // no Source behind it (an FAQ Concept, a live API result) names the Concept.
        sources.push(
          `[Source: ${source.collectionName} - ${source.sourceName || source.conceptTitle}]`
        );
      }
    }
  }
  return [chunks.join("..."), ...sources].filter(Boolean).join("\n");
}

/** The reference's string form of a stored -1/0/1 vote. */
function feedbackLabel(
  feedback: StoredMessage["feedback"]
): "positive" | "negative" | null {
  if (feedback === 1) return "positive";
  if (feedback === -1) return "negative";
  return null;
}

/** End-of-turn follow-ups, which the trace reports as `[Suggested questions:]`. */
function followUps(content: readonly unknown[]): string[] {
  const parts = content as ChatReplyPart[];
  return parts.flatMap((part) =>
    part && typeof part === "object" && part.type === "follow_ups"
      ? part.questions
      : []
  );
}

export function conversationExportRows(
  inputs: readonly ConversationExportInput[],
  options: ConversationExportOptions
): ConversationExportRow[] {
  return inputs.map(({ conversation, messages }) => {
    const meta = conversation.metadata ?? {};
    const externalData = meta.externalUserData;
    return {
      "Conversation ID": conversation.id,
      "User Name": str(meta.userName),
      "User Email": str(meta.userEmail),
      "User Role": str(meta.userRole),
      "Student ID": str(meta.studentId),
      "Assistant ID": conversation.assistantId,
      "Assistant Name": str(conversation.assistantTitle),
      "Course ID": str(meta.courseId),
      "Course Name": str(meta.courseName),
      Date: conversation.createdAt,
      "Messages Count": messages.length,
      "Positive Feedback Count": messages.filter((m) => m.feedback === 1).length,
      "Negative Feedback Count": messages.filter((m) => m.feedback === -1).length,
      "Escalation Status": meta.escalated ? "Escalated" : "",
      "Escalation Help Desk": str(meta.escalationHelpDesk),
      "Escalation Option": str(meta.escalationOption),
      "Session Launch URL": str(meta.launchUrl),
      "IP Address": str(meta.ip),
      Browser: str(meta.browser),
      OS: str(meta.os),
      Resolution: str(meta.resolution),
      Language: str(meta.language),
      "Country Code": str(meta.location),
      City: str(meta.city),
      "CSAT Score": str(meta.csatScore),
      "CSAT Comment": str(meta.csatComment),
      "External User Data":
        externalData && Object.keys(externalData).length > 0
          ? JSON.stringify(externalData)
          : "",
      "External User Data Source Names": (
        meta.externalUserDataSourceNames ?? []
      ).join(", "),
      Messages: messages.map((message) => ({
        Sender: message.role === "user" ? ("User" as const) : ("Assistant" as const),
        Timestamp: message.createdAt,
        Content: messageContent(message.content ?? []),
        Feedback: feedbackLabel(message.feedback),
        AgenticTrace:
          message.role === "assistant"
            ? serializeAgenticTrace({
                flowName: message.flowName ?? null,
                steps: message.trace?.steps ?? [],
                followUps: followUps(message.content ?? []),
                includeReasoning: options.includeReasoning,
                iterationLimit: options.iterationLimit,
              })
            : "",
      })),
    };
  });
}
