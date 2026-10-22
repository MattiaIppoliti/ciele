import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import {
  coerceWorkQuery,
  compareTasks,
  defaultWorkQuery,
  groupPatch,
  groupTasks,
  matchesWorkQuery,
  parseFilters,
  serializeFilters,
  workQueryFromParams,
  workQueryToParams,
  type WorkViewContext,
} from "./work-view";

function task(overrides: Partial<Task>): Task {
  return {
    id: "t",
    organizationId: "o",
    projectId: "p1",
    parentId: null,
    seq: 1,
    title: "Task",
    description: "",
    status: "to_do",
    priority: "none",
    assigneeMemberId: null,
    assigneeTeammateId: null,
    startDate: null,
    dueDate: null,
    estimateMinutes: null,
    recurrence: null,
    rank: "V",
    improvementId: null,
    completedAt: null,
    archivedAt: null,
    createdBy: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    ...overrides,
  };
}

const ctx: WorkViewContext = {
  today: "2026-10-09",
  now: "2026-10-09T12:00:00.000Z",
  labelsOf: (id) => (id === "a" ? ["bug"] : []),
  keyOf: (t) => `WEB-${t.seq}`,
};

describe("serialisation", () => {
  it("round-trips a query through URL params", () => {
    const query = {
      ...defaultWorkQuery(),
      filters: [
        { field: "status" as const, op: "is" as const, values: ["to_do", "in_progress"] },
        { field: "priority" as const, op: "not" as const, values: ["none"] },
      ],
      sort: { field: "due" as const, direction: "desc" as const },
      group: "assignee" as const,
      text: "login",
    };
    const params = new URLSearchParams(workQueryToParams(query));
    expect(workQueryFromParams(params)).toEqual(query);
  });

  it("omits defaults so a fresh view has a clean URL", () => {
    expect(workQueryToParams(defaultWorkQuery())).toEqual({ f: "", sort: "", group: "", q: "" });
  });

  it("drops unknown fields and unsafe values", () => {
    expect(parseFilters("nope:is:x;status:maybe:x;label:is:ok,bad value,<x>")).toEqual([
      { field: "label", op: "is", values: ["ok"] },
    ]);
    expect(serializeFilters([{ field: "status", op: "is", values: [] }])).toBe("");
  });

  it("coerces an untrusted Saved View body", () => {
    expect(coerceWorkQuery({ filters: [{ field: "status", values: ["done"] }], sort: { field: "evil" } })).toEqual({
      ...defaultWorkQuery(),
      filters: [{ field: "status", op: "is", values: ["done"] }],
    });
    expect(coerceWorkQuery(null)).toEqual(defaultWorkQuery());
  });
});

describe("matchesWorkQuery", () => {
  it("keeps only the viewer's starred Tasks under the starred chip", () => {
    const query = defaultWorkQuery({ filters: [{ field: "starred", op: "is", values: ["yes"] }] });
    const starred = { ...ctx, isStarred: (id: string) => id === "a" };
    expect(matchesWorkQuery(task({ id: "a" }), query, starred)).toBe(true);
    expect(matchesWorkQuery(task({ id: "b" }), query, starred)).toBe(false);
    // A context that cannot tell treats every Task as unstarred.
    expect(matchesWorkQuery(task({ id: "a" }), query, ctx)).toBe(false);
  });

  it("ORs inside a filter and ANDs across filters", () => {
    const query = {
      ...defaultWorkQuery(),
      filters: [
        { field: "status" as const, op: "is" as const, values: ["to_do", "done"] },
        { field: "label" as const, op: "is" as const, values: ["bug"] },
      ],
    };
    expect(matchesWorkQuery(task({ id: "a", status: "done" }), query, ctx)).toBe(true);
    expect(matchesWorkQuery(task({ id: "b", status: "done" }), query, ctx)).toBe(false);
    expect(matchesWorkQuery(task({ id: "a", status: "in_review" }), query, ctx)).toBe(false);
  });

  it("matches unassigned, due buckets, recency and text on the key", () => {
    const q = (filters: ReturnType<typeof defaultWorkQuery>["filters"], text = "") => ({
      ...defaultWorkQuery(),
      filters,
      text,
    });
    expect(matchesWorkQuery(task({}), q([{ field: "assignee", op: "is", values: ["none"] }]), ctx)).toBe(true);
    expect(
      matchesWorkQuery(task({ dueDate: "2026-10-01" }), q([{ field: "due", op: "is", values: ["overdue"] }]), ctx)
    ).toBe(true);
    expect(matchesWorkQuery(task({}), q([{ field: "updated", op: "is", values: ["1"] }]), ctx)).toBe(false);
    expect(matchesWorkQuery(task({}), q([{ field: "updated", op: "is", values: ["7"] }]), ctx)).toBe(true);
    expect(matchesWorkQuery(task({ seq: 42 }), q([], "web-42"), ctx)).toBe(true);
  });
});

describe("compareTasks", () => {
  it("puts urgent first for an ascending priority sort, ties by rank", () => {
    const tasks = [
      task({ id: "1", priority: "low", rank: "a" }),
      task({ id: "2", priority: "urgent", rank: "c" }),
      task({ id: "3", priority: "urgent", rank: "b" }),
    ];
    expect(tasks.sort(compareTasks({ field: "priority", direction: "asc" }, {})).map((t) => t.id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("keeps undated Tasks last in both directions", () => {
    const tasks = [task({ id: "x" }), task({ id: "y", dueDate: "2026-10-10" }), task({ id: "z", dueDate: "2026-10-01" })];
    expect(tasks.sort(compareTasks({ field: "due", direction: "desc" }, {})).map((t) => t.id)).toEqual(["y", "z", "x"]);
  });
});

describe("grouping", () => {
  it("lists every status group, even empty ones", () => {
    const groups = groupTasks([task({ status: "done" })], "status", ctx);
    expect(groups.map((g) => g.key)).toEqual(["backlog", "to_do", "in_progress", "in_review", "done"]);
    expect(groups[4]!.tasks).toHaveLength(1);
  });

  it("drops empty due groups and orders assignees by name, unassigned last", () => {
    const tasks = [task({ id: "1", assigneeMemberId: "u-b" }), task({ id: "2" }), task({ id: "3", assigneeMemberId: "u-a" })];
    const groups = groupTasks(tasks, "assignee", { ...ctx, assigneeName: (id) => (id === "u-a" ? "Ada" : "Bob") });
    expect(groups.map((g) => g.key)).toEqual(["u-a", "u-b", "none"]);
    expect(groupTasks([task({})], "due", ctx).map((g) => g.key)).toEqual(["none"]);
  });

  it("turns a group key back into the fields a dropped Task gets", () => {
    expect(groupPatch("status", "done", ctx.today)).toEqual({ status: "done" });
    expect(groupPatch("assignee", "none", ctx.today)).toEqual({ assigneeMemberId: null });
    expect(groupPatch("due", "today", ctx.today)).toEqual({ dueDate: "2026-10-09" });
    expect(groupPatch("status", "bogus", ctx.today)).toEqual({});
  });
});
