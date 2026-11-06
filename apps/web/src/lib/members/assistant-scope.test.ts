import { describe, expect, it } from "vitest";
import {
  choiceLabel,
  defaultAssistantChoice,
  draftAccess,
  draftFrom,
  sameDraft,
  scopeSummary,
  withAllSelected,
  withRow,
  withScope,
} from "./assistant-scope";

const ROLES = [
  { id: "r-viewer", name: "Viewer", key: "viewer", assistantDefault: true },
  { id: "r-editor", name: "Editor", key: "editor", assistantDefault: false },
  { id: "r-flows", name: "Flow builder", key: null, assistantDefault: false },
];

describe("assistant scope draft", () => {
  it("summarises a row the way the database reads it", () => {
    expect(scopeSummary({ role: "owner", scope: "all", rows: 3 })).toBe("All assistants · Owner");
    expect(scopeSummary({ role: "editor", scope: "all", rows: 0 })).toBe("All assistants · Editor");
    expect(scopeSummary({ role: "editor", scope: "all", rows: 2 })).toBe("All assistants · 2 overrides");
    expect(scopeSummary({ role: "viewer", scope: "selected", rows: 1 })).toBe("1 assistant");
    expect(scopeSummary({ role: "support_agent", scope: "selected", rows: 0 })).toBe("0 assistants");
  });

  it("reads each row as its Role id, a denial, or a built-in from before Role ids", () => {
    const start = draftFrom("all", [
      { assistantId: "a", role: "denied" },
      { assistantId: "b", role: "editor", roleId: "r-editor" },
      { assistantId: "c", role: "viewer" },
    ]);
    expect(start.rows).toEqual({ a: "denied", b: "r-editor", c: "builtin:viewer" });
    const limited = withScope(start, "selected");
    expect(limited.rows).toEqual({ b: "r-editor", c: "builtin:viewer" });
    expect(withScope(limited, "all").rows).toEqual(limited.rows);
  });

  it("ticks every Assistant at the Assistant default without overwriting a chosen Role", () => {
    const draft = withAllSelected(withRow(draftFrom("selected", []), "a", "r-flows"), ["a", "b"], true, defaultAssistantChoice(ROLES));
    expect(draft.rows).toEqual({ a: "r-flows", b: "r-viewer" });
    expect(withAllSelected(draft, ["a", "b"], false, "r-viewer").rows).toEqual({});
  });

  it("names a row by its Role", () => {
    expect(choiceLabel("r-flows", ROLES)).toBe("Flow builder");
    expect(choiceLabel("builtin:admin", ROLES)).toBe("Admin");
    expect(choiceLabel("denied", ROLES)).toBe("Denied");
    expect(choiceLabel(null, ROLES)).toBe("Organization role");
  });

  it("writes the rows in list order, with Role ids, and never a denial for a limited Member", () => {
    const draft = { scope: "selected" as const, rows: { b: "r-flows", a: "denied", c: "builtin:editor" } };
    expect(draftAccess(draft, ["a", "b", "c"])).toEqual([
      { assistantId: "b", role: "viewer", roleId: "r-flows" },
      { assistantId: "c", role: "editor" },
    ]);
    expect(draftAccess({ ...draft, scope: "all" }, ["a", "b"])).toEqual([
      { assistantId: "a", role: "denied" },
      { assistantId: "b", role: "viewer", roleId: "r-flows" },
    ]);
    expect(sameDraft(draft, { scope: "selected", rows: { a: "denied", b: "r-flows", c: "builtin:editor" } })).toBe(true);
    expect(sameDraft(draft, { ...draft, scope: "all" })).toBe(false);
  });
});
