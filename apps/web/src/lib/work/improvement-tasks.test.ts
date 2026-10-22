import { describe, expect, it } from "vitest";
import type { Task } from "@agent-hub/core";
import {
  improvementTaskProgress,
  improvementTaskRow,
  improvementTaskRows,
  matchesImprovement,
  mergeImprovementTaskRows,
  resolvableImprovements,
} from "./improvement-tasks";

function task(overrides: Partial<Task> & Pick<Task, "id" | "seq">): Task {
  return {
    organizationId: "org",
    projectId: "p1",
    parentId: null,
    title: `Task ${overrides.seq}`,
    description: "",
    status: "to_do",
    priority: "none",
    assigneeMemberId: null,
    assigneeTeammateId: null,
    startDate: null,
    dueDate: null,
    estimateMinutes: null,
    recurrence: null,
    rank: "a",
    improvementId: "imp",
    completedAt: null,
    archivedAt: null,
    createdBy: null,
    createdAt: `2026-10-0${overrides.seq}T00:00:00.000Z`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const PROJECTS = [
  { id: "p1", key: "WEB" },
  { id: "p2", key: "OPS" },
];

describe("an Improvement's Tasks", () => {
  it("keys each Task by its own Project, and falls back where the Project is not known", () => {
    const rows = improvementTaskRows(
      [task({ id: "a", seq: 1 }), task({ id: "b", seq: 2, projectId: "p2" }), task({ id: "c", seq: 3, projectId: "gone" })],
      PROJECTS
    );
    expect(rows.map((row) => row.key)).toEqual(["WEB-1", "OPS-2", "TASK-3"]);
  });

  it("lists moving work first, finished work next and archived work last, each in filing order", () => {
    const rows = improvementTaskRows(
      [
        task({ id: "archived", seq: 1, archivedAt: "2026-10-05T00:00:00.000Z" }),
        task({ id: "done", seq: 2, status: "done" }),
        task({ id: "later", seq: 4, status: "in_progress" }),
        task({ id: "earlier", seq: 3, status: "backlog" }),
      ],
      PROJECTS
    );
    expect(rows.map((row) => row.id)).toEqual(["earlier", "later", "done", "archived"]);
    expect(rows.at(-1)?.archived).toBe(true);
  });

  it("keeps a Task created here until the server's read carries it, then takes the server's copy", () => {
    const server = improvementTaskRows([task({ id: "a", seq: 1 })], PROJECTS);
    const created = improvementTaskRow(task({ id: "b", seq: 2 }), "WEB");
    expect(mergeImprovementTaskRows(server, [created]).map((row) => row.id)).toEqual(["a", "b"]);

    const refreshed = improvementTaskRows([task({ id: "a", seq: 1 }), task({ id: "b", seq: 2, status: "done" })], PROJECTS);
    const merged = mergeImprovementTaskRows(refreshed, [created]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.id === "b")?.status).toBe("done");
  });

  it("counts done over live Tasks, the way rule 3 does, so an archived one is neither", () => {
    const rows = improvementTaskRows(
      [
        task({ id: "a", seq: 1, status: "done" }),
        task({ id: "b", seq: 2 }),
        task({ id: "c", seq: 3, status: "done", archivedAt: "2026-10-05T00:00:00.000Z" }),
      ],
      PROJECTS
    );
    expect(improvementTaskProgress(rows)).toEqual({ done: 1, total: 2 });
    expect(improvementTaskProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("the Resolves picker", () => {
  const improvements = [
    { id: "1", seq: 1, title: "Wrong opening hours", status: "to_do" as const },
    { id: "2", seq: 2, title: "Fee deadline missing", status: "done" as const },
    { id: "3", seq: 3, title: "Library card answer", status: "in_review" as const },
    { id: "4", seq: 4, title: "Old", status: "archived" as const },
    { id: "12", seq: 12, title: "Parking permits", status: "in_progress" as const },
  ];

  it("offers only open Improvements, In review included, newest first", () => {
    expect(resolvableImprovements(improvements).map((i) => i.seq)).toEqual([12, 3, 1]);
  });

  it("matches the key or the title, ignoring case", () => {
    expect(matchesImprovement(improvements[0]!, "")).toBe(true);
    expect(matchesImprovement(improvements[0]!, "IMP-1")).toBe(true);
    expect(matchesImprovement(improvements[0]!, "hours")).toBe(true);
    expect(matchesImprovement(improvements[0]!, "parking")).toBe(false);
    expect(matchesImprovement(improvements[4]!, "12")).toBe(true);
  });
});
