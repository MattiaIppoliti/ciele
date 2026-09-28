import { recordsToCsv } from "@ciele/ops/csv";

/** Hands `body` to the browser as a downloaded file named `filename`. */
export function downloadFile(body: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking in the same task can cancel the download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads `rows` as indented JSON or as CSV. The CSV goes through
 * `recordsToCsv`, which neutralises cells a spreadsheet would run; with no
 * rows there are no keys to read, so `emptyHeaders` names the header line.
 */
export function downloadRows(
  rows: Record<string, unknown>[],
  format: "csv" | "json",
  filename: string,
  emptyHeaders: string[],
) {
  if (format === "json") {
    downloadFile(JSON.stringify(rows, null, 2), "application/json", filename);
  } else {
    downloadFile(
      recordsToCsv(rows, rows.length ? undefined : emptyHeaders),
      "text/csv",
      filename,
    );
  }
}
