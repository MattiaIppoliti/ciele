import { describe, expect, it } from "vitest";
import { groupByAge, inTab, notificationText } from "./notification-groups";

const base = {
  actorName: "Ada",
  actorTeammateId: null,
  project: { id: "p", key: "WEB", name: "Web", color: "blue" as const, icon: "globe" },
  task: { id: "t", projectId: "p", parentId: null, seq: 12, title: "Fix", status: "to_do" as const, priority: "none" as const, assigneeMemberId: null, dueDate: null },
};

describe("notification rows", () => {
  it("says who did what to which Task", () => {
    expect(notificationText({ ...base, kind: "assigned" })).toBe("Ada assigned you WEB-12");
    expect(notificationText({ ...base, kind: "mentioned" })).toBe("Ada mentioned you on WEB-12");
    expect(notificationText({ ...base, kind: "commented", actorName: null, actorTeammateId: "tm" })).toBe("A Teammate commented on WEB-12");
    expect(notificationText({ ...base, kind: "status_changed", actorName: null })).toBe("Someone changed the status of WEB-12");
  });

  it("files each kind under its tab, and every kind under All", () => {
    expect(inTab({ kind: "mentioned" }, "mentions")).toBe(true);
    expect(inTab({ kind: "mentioned" }, "comments")).toBe(false);
    expect(inTab({ kind: "status_changed" }, "updates")).toBe(true);
    expect(inTab({ kind: "assigned" }, "all")).toBe(true);
  });

  it("groups by age, newest first", () => {
    const groups = groupByAge(
      [
        { id: "a", createdAt: "2026-10-01T10:00:00.000Z" },
        { id: "b", createdAt: "2026-10-09T08:00:00.000Z" },
        { id: "c", createdAt: "2026-10-08T22:00:00.000Z" },
        { id: "d", createdAt: "2026-10-05T09:00:00.000Z" },
        { id: "e", createdAt: "2026-10-09T09:00:00.000Z" },
      ],
      "2026-10-09"
    );
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["e", "b"]],
      ["Yesterday", ["c"]],
      ["This week", ["d"]],
      ["Earlier", ["a"]],
    ]);
  });
});
