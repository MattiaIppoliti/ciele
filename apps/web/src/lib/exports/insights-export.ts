import JSZip from "jszip";
import type { ExportJobFormat, ExportJobKind } from "@agent-hub/core";
import { tableToCsv } from "@ciele/ops/csv";
import type { InsightsOverview } from "@/lib/insights/report";
import { escapeMarkup } from "@/lib/escape";

/**
 * An Insights export in two steps: pick the rows the report kind contains
 * (`insightsExportTable`), then package them in the requested file type
 * (`renderExportTable`). Every kind and every format meet at one table shape,
 * so adding a kind never means writing it three times.
 */

export interface ExportTable {
  headers: string[];
  rows: Array<Array<string | number>>;
}

export const EXPORT_KIND_LABELS: Record<ExportJobKind, string> = {
  insights_overview: "Aggregated insights",
  insights_datapoints: "Datapoints",
  insights_languages: "Languages",
};

/** The overview's chart as one row per bucket and one column per series. */
function overviewTable(overview: InsightsOverview): ExportTable {
  const { labels, series } = overview.chart;
  return {
    headers: ["date", ...series.map((s) => s.key)],
    rows: labels.map((label, index) => [label, ...series.map((s) => s.values[index] ?? 0)]),
  };
}

/**
 * The headline KPIs, one metric per row. A rate the window cannot measure is
 * an empty cell, the same "no data" the card shows, never a zero.
 */
function datapointsTable(overview: InsightsOverview): ExportTable {
  const s = overview.stats;
  const cell = (value: number | null) => (value === null ? "" : value);
  const rows: Array<[string, string | number]> = [
    ["Conversations", s.total],
    ["Escalated to human", s.escalated],
    ["AI resolution rate (%)", cell(s.resolutionRate)],
    ["Answer rating (%)", s.answerRating],
    ["Positive ratings", s.positive],
    ["Negative ratings", s.negative],
    ["AI answers", s.aiAnswers],
    ["User messages", s.userMessages],
    ["Notifications sent", s.notifications],
    ["Unique users", s.uniqueUsers],
    ["Conversations per user", s.conversationsPerUser],
    ["Answers per conversation", s.answersPerConversation],
    ["Questions per conversation", s.questionsPerConversation],
    ["Average conversation time (seconds)", cell(s.avgConversationSeconds ?? null)],
    ["Languages spoken", s.languages.length],
    ["Escalation intent (%)", cell(s.escalationIntentRate)],
    ["Implicit satisfaction (%)", cell(s.implicitSatisfaction)],
  ];
  return { headers: ["metric", "value"], rows };
}

function languagesTable(overview: InsightsOverview): ExportTable {
  return {
    headers: ["language", "conversations"],
    rows: overview.stats.languages.map(([language, count]) => [language, count]),
  };
}

export function insightsExportTable(kind: ExportJobKind, overview: InsightsOverview): ExportTable {
  switch (kind) {
    case "insights_overview":
      return overviewTable(overview);
    case "insights_datapoints":
      return datapointsTable(overview);
    case "insights_languages":
      return languagesTable(overview);
  }
}

/** "A", "B", ... "Z", "AA": the spreadsheet column for a zero-based index. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * The smallest valid workbook: one sheet, numbers as numbers and text as
 * inline strings, so no shared-strings table is needed. Text is never read as
 * a formula here, because an inline string cell has no formula to run.
 */
async function tableToXlsx(table: ExportTable, sheetName: string): Promise<Uint8Array> {
  const rowXml = [table.headers, ...table.rows]
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          return typeof value === "number" && Number.isFinite(value)
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeMarkup(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  // Sheet names are capped at 31 characters and may not contain []:*?/\.
  const safeName = escapeMarkup(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Export");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The table in the requested file type. JSON is one object per row, keyed by header. */
export async function renderExportTable(
  format: ExportJobFormat,
  table: ExportTable,
  sheetName: string
): Promise<string | Uint8Array> {
  switch (format) {
    case "csv":
      return tableToCsv(table.headers, table.rows);
    case "json":
      return JSON.stringify(
        table.rows.map((row) => Object.fromEntries(table.headers.map((header, i) => [header, row[i] ?? null]))),
        null,
        2
      );
    case "xlsx":
      return tableToXlsx(table, sheetName);
  }
}
