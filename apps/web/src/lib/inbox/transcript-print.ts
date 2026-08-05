import type { InboxConversation, StoredMessage } from "@agent-hub/core";
import { messageContent } from "./conversation-export";

/**
 * A single Conversation transcript as a self-contained, printable HTML document
 * (#561) — the reference platform's "export this transcript as PDF" affordance.
 *
 * There is no PDF library here on purpose. The browser's own print pipeline turns
 * this document into a PDF, which means it **paginates** rather than fitting a
 * transcript into one page: a 200-turn conversation prints 200 turns. A canvas- or
 * jsPDF-style renderer is what truncates long transcripts, and not truncating is
 * the requirement.
 *
 * Pure and string-returning so the document is testable without a browser; the
 * caller owns the printing (see `printTranscript` in the Inbox client).
 */

/** HTML-escapes a value for text content and attribute use alike. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface TranscriptDocumentInput {
  conversation: InboxConversation;
  messages: StoredMessage[];
  /** Who exported it, for the footer line. */
  organizationName?: string;
}

function detailRows(conversation: InboxConversation): Array<[string, string]> {
  const meta = conversation.metadata ?? {};
  return [
    ["Conversation ID", conversation.id],
    ["Assistant", conversation.assistantTitle],
    ["Started", conversation.createdAt],
    ["Course", conversation.collectionName ?? "N/A"],
    ["User", meta.userName ?? meta.userEmail ?? conversation.subjectId],
    ["Role", meta.userRole ?? "N/A"],
    ["Language", meta.language ?? "N/A"],
    ["Location", [meta.city, meta.location].filter(Boolean).join(", ") || "N/A"],
    ["Launch URL", meta.launchUrl ?? "N/A"],
    [
      "Escalation",
      meta.escalated
        ? [meta.escalationHelpDesk, meta.escalationOption]
            .filter(Boolean)
            .join(" · ") || "Escalated"
        : "Not escalated",
    ],
  ];
}

const VOTE_LABELS: Record<-1 | 0 | 1, string> = {
  1: "Rated helpful",
  0: "",
  [-1]: "Rated not helpful",
};

export function transcriptDocument(input: TranscriptDocumentInput): string {
  const { conversation, messages } = input;
  const title = conversation.title?.trim() || "Conversation transcript";

  const turns = messages
    .map((message) => {
      const body = messageContent(message.content ?? []);
      // A turn whose parts render to nothing (a bare button, an iframe chip) still
      // happened — printing a blank block is more honest than dropping the turn.
      const text = body.trim() || "(no text content)";
      const vote = VOTE_LABELS[message.feedback];
      const meta = [
        message.role === "user" ? "User" : "Assistant",
        message.createdAt,
        message.role === "assistant" && message.flowName
          ? `Workflow: ${message.flowName}`
          : "",
        vote,
      ].filter(Boolean);
      return `<article class="turn ${message.role}">
  <p class="meta">${meta.map(escapeHtml).join(" · ")}</p>
  <div class="body">${escapeHtml(text)}</div>
</article>`;
    })
    .join("\n");

  const details = detailRows(conversation)
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  /* Print-first: the browser paginates, so nothing here may clip or scroll. */
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 12px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    color: #111;
  }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .subtitle { color: #555; margin: 0 0 14px; font-size: 11px; }
  dl { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; margin: 0 0 18px; }
  dl > div { display: flex; gap: 6px; min-width: 0; }
  dt { color: #666; flex: 0 0 92px; }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .turn {
    /* Keep a turn on one page where it fits; a long one still splits rather
       than being cut off. */
    break-inside: avoid;
    page-break-inside: avoid;
    padding: 8px 0 10px;
    border-top: 1px solid #e5e5e5;
  }
  .turn .meta { margin: 0 0 4px; color: #666; font-size: 10px; }
  .turn .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  .turn.user .body { font-weight: 600; }
  footer { margin-top: 18px; border-top: 1px solid #e5e5e5; padding-top: 8px; color: #666; font-size: 10px; }
  @media print { .turn { break-inside: auto; page-break-inside: auto; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="subtitle">${escapeHtml(
    `${messages.length} ${messages.length === 1 ? "message" : "messages"}`
  )}</p>
<dl>${details}</dl>
${turns}
<footer>${escapeHtml(
    [input.organizationName, "Conversation transcript"].filter(Boolean).join("N/A")
  )}</footer>
</body>
</html>`;
}
