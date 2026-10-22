import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import {
  addMonths,
  canNestUnder,
  canReadProject,
  canWriteProject,
  deriveProjectKey,
  dueBucket,
  formatEstimate,
  improvementStatusAfterTasks,
  mentionToken,
  myTaskGroup,
  nextOccurrence,
  parseEstimate,
  parseMentionTokens,
  projectProgress,
  rankBetween,
  ranksAfter,
  splitMentionTokens,
  taskProgress,
  workNotificationRecipients,
  wouldCreateCycle,
} from "./work";

describe("rankBetween", () => {
  it("orders every generated key strictly between its neighbours", () => {
    const first = rankBetween(null, null);
    const after = rankBetween(first, null);
    const before = rankBetween(null, first);
    const middle = rankBetween(first, after);
    expect(before < first && first < middle && middle < after).toBe(true);
  });

  it("never runs out of room when inserting into the same gap many times", () => {
    let lo = rankBetween(null, null);
    const hi = rankBetween(lo, null);
    for (let i = 0; i < 200; i += 1) {
      const next = rankBetween(lo, hi);
      expect(next > lo && next < hi).toBe(true);
      expect(next.endsWith("0")).toBe(false);
      lo = next;
    }
    expect(lo.length).toBeLessThan(200);
  });

  it("inserts before the first key repeatedly", () => {
    let hi = rankBetween(null, null);
    for (let i = 0; i < 100; i += 1) {
      const next = rankBetween(null, hi);
      expect(next < hi).toBe(true);
      hi = next;
    }
  });

  it("sorts the same way as byte order (the database's collate C)", () => {
    const keys = ranksAfter(null, 50);
    expect([...keys].sort()).toEqual(keys);
  });

  it("refuses an inverted range", () => {
    expect(() => rankBetween("b", "a")).toThrow();
  });
});

describe("deriveProjectKey", () => {
  it("takes the initials of the name", () => {
    expect(deriveProjectKey("Website Redesign", [])).toBe("WR");
    expect(deriveProjectKey("Mobile App Launch Plan", [])).toBe("MAL");
  });

  it("pads a one-word name from its letters", () => {
    expect(deriveProjectKey("Marketing", [])).toBe("MA");
    expect(deriveProjectKey("", [])).toBe("PR");
  });

  it("appends a number until unique, case-insensitively", () => {
    expect(deriveProjectKey("Website Redesign", ["wr", "WR2"])).toBe("WR3");
  });

  it("produces keys the database accepts", () => {
    for (const name of ["Ünïcode ✨ project", "42 things", "a"]) {
      expect(deriveProjectKey(name, [])).toMatch(/^[A-Z][A-Z0-9]{1,4}$/);
    }
  });
});

describe("nesting and dependencies", () => {
  const parent = { id: "t1", parentId: null, projectId: "p1" };
  it("allows one level, inside one Project", () => {
    expect(canNestUnder(parent, { id: "t2", projectId: "p1" }, false)).toBe(true);
    expect(canNestUnder({ ...parent, parentId: "t0" }, { id: "t2", projectId: "p1" }, false)).toBe(false);
    expect(canNestUnder(parent, { id: "t2", projectId: "p1" }, true)).toBe(false);
    expect(canNestUnder(parent, { id: "t2", projectId: "p2" }, false)).toBe(false);
    expect(canNestUnder(parent, { id: "t1", projectId: "p1" }, false)).toBe(false);
  });

  it("detects a cycle through blocked-by edges", () => {
    const edges = [
      { taskId: "a", blockedById: "b" },
      { taskId: "b", blockedById: "c" },
    ];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
  });
});

describe("estimates", () => {
  it("formats minutes with an eight-hour day", () => {
    expect(formatEstimate(30)).toBe("30m");
    expect(formatEstimate(90)).toBe("1h 30m");
    expect(formatEstimate(960)).toBe("2d");
    expect(formatEstimate(null)).toBe("");
  });

  it("parses what it formats, and a bare number as hours", () => {
    for (const minutes of [30, 60, 90, 480, 960, 3840, 545]) {
      expect(parseEstimate(formatEstimate(minutes))).toBe(minutes);
    }
    expect(parseEstimate("2")).toBe(120);
    expect(parseEstimate("1.5h")).toBe(90);
    expect(parseEstimate("soon")).toBeNull();
    expect(parseEstimate("2 days")).toBeNull();
  });
});

describe("recurrence", () => {
  it("shifts due and keeps the duration", () => {
    expect(
      nextOccurrence({ startDate: "2026-10-05", dueDate: "2026-10-09", recurrence: "weekly" })
    ).toEqual({ startDate: "2026-10-12", dueDate: "2026-10-16" });
  });

  it("uses calendar months, clamped", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextOccurrence({ startDate: null, dueDate: "2028-01-31", recurrence: "monthly" })).toEqual({
      startDate: null,
      dueDate: "2028-02-29",
    });
  });

  it("has no next without a due date", () => {
    expect(nextOccurrence({ startDate: null, dueDate: null, recurrence: "daily" })).toBeNull();
  });
});

describe("dates and groups", () => {
  const today = "2026-10-09";
  it("buckets due dates", () => {
    expect(dueBucket({ dueDate: "2026-10-08", status: "to_do" }, today)).toBe("overdue");
    expect(dueBucket({ dueDate: "2026-10-09", status: "to_do" }, today)).toBe("today");
    expect(dueBucket({ dueDate: "2026-10-15", status: "to_do" }, today)).toBe("week");
    expect(dueBucket({ dueDate: "2026-12-01", status: "to_do" }, today)).toBe("later");
    expect(dueBucket({ dueDate: null, status: "to_do" }, today)).toBe("none");
  });

  it("puts done Tasks in Completed whatever their date", () => {
    expect(myTaskGroup({ dueDate: "2026-01-01", status: "done" }, today)).toBe("completed");
    expect(myTaskGroup({ dueDate: "2026-01-01", status: "to_do" }, today)).toBe("overdue");
    expect(myTaskGroup({ dueDate: null, status: "to_do" }, today)).toBe("no_date");
  });
});

describe("progress", () => {
  it("uses subtasks when there are any", () => {
    expect(
      taskProgress({ status: "in_progress" }, [
        { status: "done", archivedAt: null },
        { status: "to_do", archivedAt: null },
        { status: "done", archivedAt: "2026-01-01" },
      ])
    ).toBe(50);
    expect(taskProgress({ status: "done" })).toBe(100);
    expect(taskProgress({ status: "in_review" })).toBe(80);
  });

  it("counts live top-level Tasks for a Project", () => {
    expect(
      projectProgress([
        { status: "done", archivedAt: null, parentId: null },
        { status: "to_do", archivedAt: null, parentId: null },
        { status: "done", archivedAt: null, parentId: "x" },
        { status: "done", archivedAt: "2026-01-01", parentId: null },
      ])
    ).toEqual({ done: 1, total: 2, percent: 50 });
  });
});

describe("canReadProject", () => {
  const open = { visibility: "organization" as const, createdBy: "u-creator" };
  const closed = { visibility: "private" as const, createdBy: "u-creator" };
  it("lets any Member read an org-visible Project", () => {
    expect(canReadProject(open, [], { userId: "u-1", role: "viewer" })).toBe(true);
  });

  it("keeps a private one to its members and admins", () => {
    expect(canReadProject(closed, ["u-1"], { userId: "u-1", role: "viewer" })).toBe(true);
    expect(canReadProject(closed, [], { userId: "u-2", role: "admin" })).toBe(true);
    expect(canReadProject(closed, [], { userId: "u-2", role: "editor" })).toBe(false);
  });

  it("lets the creator in only before anyone is seated", () => {
    expect(canReadProject(closed, [], { userId: "u-creator", role: "editor" })).toBe(true);
    // Removed in Share: the creator is a member like any other.
    expect(canReadProject(closed, ["u-1"], { userId: "u-creator", role: "editor" })).toBe(false);
  });

  it("needs the Editor rung to write", () => {
    expect(canWriteProject(open, [], { userId: "u-1", role: "viewer" })).toBe(false);
    expect(canWriteProject(open, [], { userId: "u-1", role: "editor" })).toBe(true);
    expect(canWriteProject(closed, [], { userId: "u-2", role: "editor" })).toBe(false);
  });

  it("refuses a non-member", () => {
    expect(canReadProject(open, [], { userId: "u-1", role: null })).toBe(false);
  });
});

describe("mention tokens", () => {
  const ada = "0b7e7c9e-1111-4222-8333-944455556666";
  it("round-trips ids and survives a rename", () => {
    const body = `Ping ${mentionToken("Ada L.", ada)} and ${mentionToken("Ada", ada)} again`;
    expect(parseMentionTokens(body)).toEqual([ada]);
    expect(splitMentionTokens(body).filter((s) => s.kind === "mention")).toHaveLength(2);
  });

  it("strips a bracket from the display name", () => {
    expect(mentionToken("A]da", ada)).toBe(`@[Ada](member:${ada})`);
  });
});

describe("workNotificationRecipients", () => {
  const task: Pick<Task, "assigneeMemberId" | "createdBy"> = {
    assigneeMemberId: "u-assignee",
    createdBy: "u-creator",
  };
  it("never notifies the actor", () => {
    expect(
      workNotificationRecipients({
        kind: "assigned",
        actorId: "u-1",
        assigneeId: "u-1",
        previousAssigneeId: null,
      })
    ).toEqual([]);
  });

  it("notifies a mention once, as a mention", () => {
    const rows = workNotificationRecipients({
      kind: "commented",
      actorId: "u-other",
      commentId: "c1",
      mentions: ["u-assignee"],
      task,
    });
    expect(rows).toEqual([
      { recipientId: "u-assignee", kind: "mentioned", commentId: "c1" },
      { recipientId: "u-creator", kind: "commented", commentId: "c1" },
    ]);
  });

  it("skips recipients who can no longer see the Task", () => {
    const rows = workNotificationRecipients(
      { kind: "status_changed", actorId: "u-x", from: "to_do", to: "done", task },
      (id) => id !== "u-creator"
    );
    expect(rows.map((row) => row.recipientId)).toEqual(["u-assignee"]);
  });

  it("raises nothing when the status did not change", () => {
    expect(
      workNotificationRecipients({ kind: "status_changed", actorId: "u-x", from: "done", to: "done", task })
    ).toEqual([]);
  });
});

describe("improvementStatusAfterTasks", () => {
  it("moves an open Improvement to In review when every live Task is done", () => {
    const done = { status: "done" as const, archivedAt: null };
    const open = { status: "to_do" as const, archivedAt: null };
    expect(improvementStatusAfterTasks("in_progress", [done, done])).toBe("in_review");
    expect(improvementStatusAfterTasks("in_progress", [done, open])).toBeNull();
    expect(improvementStatusAfterTasks("in_review", [done])).toBeNull();
    expect(improvementStatusAfterTasks("to_do", [])).toBeNull();
    expect(
      improvementStatusAfterTasks("to_do", [done, { status: "to_do", archivedAt: "2026-01-01" }])
    ).toBe("in_review");
  });
});
