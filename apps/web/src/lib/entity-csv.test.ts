import { describe, expect, it } from "vitest";
import { ENTITY_IMPORT_MAX_ROWS, parseEntityCsv } from "./entity-csv";

const entity = {
  keyAttribute: "order_id",
  attributes: [
    { key: "order_id", label: "Order ID", type: "text" as const },
    { key: "status", label: "Status", type: "text" as const },
    { key: "total", label: "Total", type: "number" as const },
    { key: "shipped_at", label: "Shipped at", type: "date" as const },
    { key: "priority", label: "Priority", type: "boolean" as const },
  ],
};

describe("parseEntityCsv", () => {
  it("maps headers by key or label, case-insensitively", () => {
    const result = parseEntityCsv(
      'Order ID,STATUS,total\nA-1,shipped,"12.50"\n',
      entity
    );
    expect(result.rejected).toEqual([]);
    expect(result.rows).toEqual([
      {
        key: "A-1",
        values: { order_id: "A-1", status: "shipped", total: 12.5 },
      },
    ]);
  });

  it("types cells: numbers, dates, booleans; empty cells become null", () => {
    const result = parseEntityCsv(
      "order_id,total,shipped_at,priority\nA-1,10,2026-08-01,yes\nA-2,,,\n",
      entity
    );
    expect(result.rejected).toEqual([]);
    expect(result.rows[0].values).toEqual({
      order_id: "A-1",
      total: 10,
      shipped_at: "2026-08-01",
      priority: true,
    });
    expect(result.rows[1].values).toEqual({
      order_id: "A-2",
      total: null,
      shipped_at: null,
      priority: null,
    });
  });

  it("rejects bad rows with 1-based line reasons while keeping good ones", () => {
    const result = parseEntityCsv(
      "order_id,total\nA-1,10\nA-2,not-a-number\n,5\nA-1,20\nA-4,1\n",
      entity
    );
    expect(result.rows.map((r) => r.key)).toEqual(["A-1", "A-4"]);
    expect(result.rejected).toEqual([
      'row 3: total is not a number: "not-a-number"',
      'row 4: empty key value ("order_id")',
      'row 5: duplicate key "A-1" (first one wins)',
    ]);
  });

  it("rejects the whole import on unknown columns (no silent data loss)", () => {
    const result = parseEntityCsv("order_id,surprise\nA-1,x\n", entity);
    expect(result.rows).toEqual([]);
    expect(result.rejected).toEqual(['unknown column: "surprise"']);
  });

  it("requires the key column", () => {
    const result = parseEntityCsv("status,total\nshipped,1\n", entity);
    expect(result.rows).toEqual([]);
    expect(result.rejected).toEqual(['missing the key column "order_id"']);
  });

  it("caps the row count and reports the cut", () => {
    const lines = ["order_id"];
    for (let i = 0; i < ENTITY_IMPORT_MAX_ROWS + 5; i++) lines.push(`K-${i}`);
    const result = parseEntityCsv(lines.join("\n"), entity);
    expect(result.rows).toHaveLength(ENTITY_IMPORT_MAX_ROWS);
    expect(result.rejected[0]).toContain("capped");
  });

  it("handles quoted fields with embedded commas and newlines", () => {
    const result = parseEntityCsv(
      'order_id,status\n"A-1","on hold,\nawaiting stock"\n',
      entity
    );
    expect(result.rows[0].values.status).toBe("on hold,\nawaiting stock");
  });
});
