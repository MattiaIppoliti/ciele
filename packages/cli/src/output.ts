/** Plain column formatting — human default; `--json` bypasses this. */
export function table(
  rows: ReadonlyArray<object>,
  columns: Array<{ key: string; header: string }>
): string {
  if (rows.length === 0) return "(none)";
  const cell = (row: object, key: string) => {
    const value = (row as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  };
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => cell(r, c.key).length))
  );
  const line = (values: string[]) =>
    values.map((v, i) => v.padEnd(widths[i])).join("  ");
  return [
    line(columns.map((c) => c.header.toUpperCase())),
    ...rows.map((r) => line(columns.map((c) => cell(r, c.key)))),
  ].join("\n");
}
