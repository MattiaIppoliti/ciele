import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_TABLE_LIMITS,
  filterTableCounts,
  normalizeFilterTable,
  normalizeRecordsTable,
} from "./interactive-tables";
import { componentPartText } from "./component-text";
import { INTERACTIVE_TABLE_TOOLS } from "./interactive-table-tools";

const record = {
  id: "one",
  name: "Acme",
  tags: ["B2B"],
  last: "Today",
  strength: "strong",
  website: "acme.example",
};
describe("interactive table boundary", () => {
  it("normalizes only safe web links, unique record identities and bounded text", () => {
    const table = normalizeRecordsTable({
      rows: [
        record,
        record,
        {
          ...record,
          id: "two",
          website: "javascript:alert(1)",
          tags: ["B2B", "B2B", 12],
        },
        { ...record, id: "three", website: "https://user:secret@example.com" },
      ],
    });
    expect(table?.rows).toHaveLength(3);
    expect(table?.rows[0]?.website).toBe("https://acme.example/");
    expect(table?.rows[1]).toMatchObject({ tags: ["B2B"] });
    expect(table?.rows[1]?.website).toBeUndefined();
    expect(table?.rows[2]?.website).toBeUndefined();
    const bounded = normalizeRecordsTable({
      rows: Array.from({ length: 120 }, (_, index) => ({
        ...record,
        id: String(index),
        name: "a".repeat(500),
      })),
    });
    expect(bounded?.rows).toHaveLength(INTERACTIVE_TABLE_LIMITS.rows);
    expect(bounded?.rows[0]?.name).toHaveLength(INTERACTIVE_TABLE_LIMITS.text);
  });
  it("does not turn incomplete or unknown statuses into invented claims", () => {
    expect(
      normalizeRecordsTable({ rows: [{ id: "partial", name: "Acme" }] })?.rows,
    ).toEqual([]);
    expect(
      normalizeFilterTable({ rows: [{ task: "Partial", status: "unknown" }] })
        ?.rows,
    ).toEqual([]);
    expect(normalizeFilterTable({})).toBeNull();
    expect(
      normalizeRecordsTable({ rows: [{ ...record, strength: "unknown" }] })
        ?.rows[0]?.strength,
    ).toBe("unknown");
  });
  it("counts supplied tasks and preserves custom column labels", () => {
    const table = normalizeFilterTable({
      rows: [
        { task: "Review", date: "Today", owner: "Alex", status: "todo" },
        { task: "Review", status: "done" },
      ],
      labels: { columns: { owner: "Responsabile" } },
    });
    expect(table?.labels.columns.owner).toBe("Responsabile");
    expect(table?.labels.columns.task).toBe("Task name");
    expect(filterTableCounts(table!.rows)).toEqual({
      all: 2,
      todo: 1,
      progress: 0,
      done: 1,
    });
  });
  it("retains literal text without accepting executable props or fixture rows", () => {
    expect(
      normalizeRecordsTable({
        rows: [{ ...record, name: "<script>alert(1)</script>" }],
        html: "malicious",
      })?.rows[0]?.name,
    ).toBe("<script>alert(1)</script>");
    expect(normalizeRecordsTable({ rows: [] })?.rows).toEqual([]);
    expect(normalizeFilterTable({ rows: [] })?.rows).toEqual([]);
  });
  it("validates each distinct tool and keeps every displayed table in plain-text exports", () => {
    const records = INTERACTIVE_TABLE_TOOLS[0];
    const tasks = INTERACTIVE_TABLE_TOOLS[1];
    expect(
      records.schema.safeParse({ rows: [{ ...record, strength: "excellent" }] })
        .success,
    ).toBe(false);
    expect(
      tasks.schema.safeParse({
        rows: [{ task: "Review", status: "later", date: "", owner: "" }],
      }).success,
    ).toBe(false);
    const crm = records.build(
      { title: "Accounts", rows: [record], additionalColumn: "Region" },
      "crm",
    );
    const filter = tasks.build(
      {
        title: "Tasks",
        rows: [
          { task: "Review", date: "Today", owner: "Alex", status: "progress" },
        ],
      },
      "filter",
    );
    if (crm?.type !== "component" || filter?.type !== "component")
      throw new Error("Missing table parts");
    expect(componentPartText(crm)).toContain(
      "Acme | B2B | Today | Very strong | https://acme.example/",
    );
    expect(componentPartText(filter)).toContain(
      "Review | Today | In Progress | Alex",
    );
  });
});
