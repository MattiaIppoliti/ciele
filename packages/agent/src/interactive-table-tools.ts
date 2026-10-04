import { z } from "zod";
import type { ChatReplyPart } from "./types";
import {
  INTERACTIVE_TABLE_LIMITS,
  normalizeFilterTable,
  normalizeRecordsTable,
} from "./interactive-tables";

const text = z.string().max(INTERACTIVE_TABLE_LIMITS.text);
const common = { title: text.optional(), caption: text.optional() };
const recordsSchema = z.object({
  ...common,
  rows: z
    .array(
      z.object({
        id: text.min(1),
        name: text.min(1),
        tags: z.array(text).max(INTERACTIVE_TABLE_LIMITS.tags),
        last: text,
        strength: z
          .enum(["strong", "weak", "veryweak", "none", "unknown"])
          .describe(
            "Use an explicitly sourced relationship status, or unknown when no status is supplied. none means sourced absence of communication. Never infer a relationship score.",
          ),
        website: z.string().max(2048).optional(),
        additional: text.optional(),
      }),
    )
    .max(INTERACTIVE_TABLE_LIMITS.rows),
  additionalColumn: text
    .optional()
    .describe(
      "Optional extra property header, with each row's sourced value in additional.",
    ),
});
const filterSchema = z.object({
  ...common,
  rows: z
    .array(
      z.object({
        task: text.min(1),
        date: text,
        status: z.enum(["todo", "progress", "done"]),
        owner: text,
      }),
    )
    .max(INTERACTIVE_TABLE_LIMITS.rows),
  labels: z
    .object({
      columns: z.object({ task: text, date: text, status: text, owner: text }),
    })
    .optional(),
});
function part(
  name: "records_table" | "filter_table",
  input: Record<string, unknown>,
  callId: string,
): ChatReplyPart | null {
  const props =
    name === "records_table"
      ? normalizeRecordsTable(input)
      : normalizeFilterTable(input);
  return props
    ? { type: "component", action: "search_knowledge", name, callId, props }
    : null;
}
const grounding =
  "Arrange only facts from the user's supplied data or sources retrieved this turn. Never fabricate sample rows, relationship scores, dates, owners or calculated values. The component is displayed and saved with the answer; refer to it without repeating its rows.";
export const INTERACTIVE_TABLE_TOOLS = [
  {
    name: "renderRecordsTable",
    component: "records_table",
    schema: recordsSchema,
    description: `Show a CRM records grid with company names, categories, last interaction, sourced connection strength and website links. Users can select records, sort and resize columns, inspect property configuration and request new properties through chat. ${grounding}`,
    build: (input: Record<string, unknown>, callId: string) =>
      part("records_table", input, callId),
  },
  {
    name: "renderFilterTable",
    component: "filter_table",
    schema: filterSchema,
    description: `Show tasks, dates, status and owners in a table with clickable status filters and accurate counts. Use status todo, progress or done only when supported by the data. Optional labels translate the four column headings. ${grounding}`,
    build: (input: Record<string, unknown>, callId: string) =>
      part("filter_table", input, callId),
  },
] as const;
