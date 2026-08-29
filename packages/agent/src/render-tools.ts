import { z } from "zod";
import type { ChatReplyPart } from "./types";
import { REPLY_COMPONENT_LIMITS, normalizeTable } from "./reply-components";

/**
 * The `renderTable` tool emits a **Reply Component** (see
 * `context.md`). No server work, no result the model reads for information, no
 * egress. The model chooses the component by calling the tool, and the tool's
 * arguments ARE the component's props.
 *
 * Why a typed component tool rather than letting the model emit
 * markup: a reply renders inside an iframe we serve on somebody else's page, so
 * model-authored HTML would be an injection surface with extra steps. Here the
 * component ships with the client, the props are validated by its own zod
 * schema, and `reply-components.ts` squares and caps them on every path.
 *
 * Why one tool per component rather than one `showComponent(name, props)`: a
 * shared tool could only take `props: unknown`, and then nothing validates the
 * shape the component actually needs.
 *
 * **Two invariants this tool is designed around.**
 *
 * 1. *Nothing grades a component.* `verifier.ts` re-reads question, answer and
 *    cited Concepts, all text (`verifier.test.ts` locks the exclusion), so an
 *    assertion made in props is one no scheduled pass checks. Components must
 *    therefore *arrange* what the turn retrieved, never compute a new claim: a
 *    table of retrieved rows is a rendering, a financial projection is an
 *    ungraded assertion.
 * 2. *A component must earn its place against markdown.* Answer text already
 *    renders GFM tables on all three surfaces (`chat-markdown.tsx`), so a
 *    component that only lays text out buys nothing. What markdown cannot do is
 *    carry behaviour, which is why the table's rows can be made askable.
 */

export const RENDER_TABLE_TOOL_NAME = "renderTable";
export const RENDER_TABLE_COMPONENT = "table";

export const RENDER_TABLE_INPUT_SCHEMA = z.object({
  title: z
    .string()
    .max(REPLY_COMPONENT_LIMITS.tableLabelChars)
    .optional()
    .describe("Short heading for the table, in the user's language."),
  columns: z
    .array(z.string().max(REPLY_COMPONENT_LIMITS.tableCellChars))
    .min(1)
    .max(REPLY_COMPONENT_LIMITS.tableColumns)
    .describe("Column headers, in the user's language."),
  rows: z
    .array(
      z
        .array(z.string().max(REPLY_COMPONENT_LIMITS.tableCellChars))
        .max(REPLY_COMPONENT_LIMITS.tableColumns)
    )
    .min(1)
    .max(REPLY_COMPONENT_LIMITS.tableRows)
    .describe(
      "Rows, each a list of cells in the same order as `columns`. Every cell must come from what you retrieved."
    ),
  askAbout: z
    .array(z.string().max(REPLY_COMPONENT_LIMITS.tableLabelChars))
    .max(REPLY_COMPONENT_LIMITS.tableRows)
    .optional()
    .describe(
      "Optional, one entry per row in the same order: the question to ask if the user taps that row, written as the user would ask it. Use an empty string for a row that needs no follow-up."
    ),
  caption: z
    .string()
    .max(REPLY_COMPONENT_LIMITS.tableLabelChars)
    .optional()
    .describe("One line under the table, for a note or a unit."),
});

export const RENDER_TABLE_DESCRIPTION = [
  "Display retrieved facts to the user as a table. Use it when the answer compares things across the same few attributes (options, plans, dates, steps with owners) and prose would make the reader hold several rows in their head.",
  "Every cell must come from what you retrieved this turn. Do not compute, estimate, project or infer values, and do not use this to lay out a single fact.",
  "Set `askAbout` when a row has an obvious follow-up: the row becomes tappable and asks that question for the user, which plain text cannot do.",
  "The table is shown to the user on its own, so after calling this, refer to it in your answer instead of repeating its contents.",
].join(" ");

export function renderTableLabel(input: Record<string, unknown>): string {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  return title ? `Showing a table: ${title}` : "Showing a table";
}

export function renderTablePart(
  input: Record<string, unknown>,
  callId: string
): ChatReplyPart | null {
  // The AI SDK validated this input against the schema already; the shared
  // normalizer is what squares and caps it, the same call the live client's
  // provisional render makes on props that passed through no schema at all.
  const table = normalizeTable(input);
  // Unreachable via the SDK (`columns` and `rows` both carry `.min(1)`), kept
  // as the narrowing that lets this function promise a non-null part.
  if (!table || table.rows.length === 0) return null;
  const askAbout = table.askAbout.map((prompt) => prompt ?? "");
  return {
    type: "component",
    action: "search_knowledge",
    name: "table",
    callId,
    props: {
      ...(table.title ? { title: table.title } : {}),
      columns: table.columns,
      rows: table.rows,
      ...(askAbout.some(Boolean) ? { askAbout } : {}),
      ...(table.caption ? { caption: table.caption } : {}),
    },
  };
}

export const RENDER_TABLE_ACK =
  "The table is now displayed to the user. Refer to it in your answer rather than repeating its rows.";
