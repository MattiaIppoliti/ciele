import { describe, expect, it } from "vitest";
import type { WorkActivity } from "@agent-hub/core";
import { WORK_ACTIVITY_VERBS } from "@agent-hub/core";
import { activityActor, activityExcerpt, activityText, groupActivityByDay, type ActivityNames } from "./activity-text";

const names: ActivityNames = {
  person: (id) => (id === "u1" ? "Ada" : id === "u2" ? "Bo" : null),
  label: (id) => (id === "l1" ? "Bug" : null),
  today: "2026-10-09",
};

function entry(over: Partial<WorkActivity>): WorkActivity {
  return {
    id: "a",
    organizationId: "o",
    projectId: "p",
    taskId: "t",
    actorMemberId: "u1",
    actorTeammateId: null,
    verb: "task.created",
    data: { taskKey: "WEB-12", taskTitle: "Brief" },
    createdAt: "2026-10-09T10:00:00Z",
    ...over,
  };
}

describe("activityText", () => {
  it("has a sentence for every verb", () => {
    for (const verb of WORK_ACTIVITY_VERBS) {
      expect(activityText(entry({ verb }), names).length).toBeGreaterThan(3);
    }
  });

  it("names statuses, people, labels and dates", () => {
    expect(activityText(entry({ verb: "task.status", data: { taskKey: "WEB-12", from: "to_do", to: "in_review" } }), names)).toBe(
      "moved WEB-12 from To do to In review"
    );
    expect(activityText(entry({ verb: "task.assigned", data: { taskKey: "WEB-12", to: "u2" } }), names)).toBe(
      "assigned WEB-12 to Bo"
    );
    expect(activityText(entry({ verb: "task.labels", data: { taskKey: "WEB-12", labelIds: ["l1"] } }), names)).toBe(
      "labelled WEB-12 Bug"
    );
    expect(activityText(entry({ verb: "task.due", data: { taskKey: "WEB-12", to: "2026-10-20" } }), names)).toBe(
      "changed the due date of WEB-12 to 20 Oct"
    );
  });

  it("names the Improvement a Task sent to review", () => {
    const data = { taskKey: "WEB-12", improvementKey: "IMP-3", improvementTitle: "Wrong hours", from: "in_progress", to: "in_review" };
    expect(activityText(entry({ verb: "improvement.review", data }), names)).toBe("moved IMP-3 to In review");
    expect(activityText(entry({ verb: "improvement.review", data: { taskKey: "WEB-12" } }), names)).toBe(
      "moved its Improvement to In review"
    );
  });

  it("speaks about this task inside its own drawer", () => {
    expect(activityText(entry({ verb: "task.completed" }), names, { withTask: false })).toBe("completed this task");
  });
});

describe("activityActor", () => {
  const withTeammates: ActivityNames = { ...names, teammate: (id) => (id === "tm" ? "Sam" : null) };

  it("attributes a Teammate's write to the Member it acted for", () => {
    expect(activityActor(entry({ actorTeammateId: "tm" }), withTeammates)).toBe("Sam for Ada");
    expect(activityActor(entry({ actorMemberId: null, actorTeammateId: "tm" }), withTeammates)).toBe("Sam");
    expect(activityActor(entry({}), withTeammates)).toBe("Ada");
  });

  it("keeps a Teammate the viewer cannot see unnamed", () => {
    expect(activityActor(entry({ actorTeammateId: "hidden" }), withTeammates)).toBe("A Teammate for Ada");
    expect(activityActor(entry({ actorTeammateId: "tm" }), names)).toBe("A Teammate for Ada");
  });
});

describe("grouping by day", () => {
  it("groups by day, newest first, and keeps a comment's excerpt", () => {
    const days = groupActivityByDay(
      [
        entry({ id: "1", createdAt: "2026-10-07T10:00:00.000Z" }),
        entry({ id: "2", createdAt: "2026-10-09T08:00:00.000Z", verb: "comment.added", data: { excerpt: "Looks good" } }),
        entry({ id: "3", createdAt: "2026-10-08T23:59:00.000Z" }),
        entry({ id: "4", createdAt: "2026-10-09T09:00:00.000Z" }),
      ],
      "2026-10-09"
    );
    expect(days.map((g) => [g.title, g.entries.map((e) => e.id)])).toEqual([
      ["Today", ["4", "2"]],
      ["Yesterday", ["3"]],
      ["7 Oct", ["1"]],
    ]);
    expect(activityExcerpt(days[0]!.entries[1]!)).toBe("Looks good");
    expect(activityExcerpt(days[0]!.entries[0]!)).toBeNull();
  });

  it("finds yesterday across a month boundary", () => {
    const days = groupActivityByDay([entry({ createdAt: "2026-09-30T18:00:00.000Z" })], "2026-10-01");
    expect(days.map((g) => g.title)).toEqual(["Yesterday"]);
  });
});
