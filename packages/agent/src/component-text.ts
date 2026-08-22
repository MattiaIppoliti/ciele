import type { ChatReplyPart } from "./types";
import { normalizeTable } from "./reply-components";

/**
 * The plain-text form of a Reply Component, for the surfaces that read a
 * persisted answer as text rather than drawing it: the Inbox JSON export's
 * `Content` field today, and anything else that has to say what the assistant
 * actually put in front of the Visitor.
 *
 * It lives in its own module, with no imports beyond the part type and the
 * shared normalizer, for the same reason `partial-json.ts` does: `client.ts`
 * re-exports it, so pulling in `render-tools.ts` (and its zod schemas) would
 * drag the whole catalogue into a browser bundle to format a string.
 *
 * A component that exported as nothing would understate the answer: an export
 * consumer would see prose referring to "the table below" with no table.
 */

type ComponentPart = Extract<ChatReplyPart, { type: "component" }>;

/** Pipe-separated rows, the shape a table survives being flattened into. */
function tableText(props: Record<string, unknown>): string {
  const table = normalizeTable(props);
  if (!table) return "";
  return [
    table.title,
    table.columns.join(" | "),
    ...table.rows.map((row) => row.join(" | ")),
    table.caption,
  ]
    .filter(Boolean)
    .join("\n");
}

export function componentPartText(part: ComponentPart): string {
  switch (part.name) {
    case "table":
      return tableText(part.props);
    default:
      // A name this build does not know (a message written by a newer runtime):
      // contribute nothing rather than a placeholder that reads like content.
      return "";
  }
}
