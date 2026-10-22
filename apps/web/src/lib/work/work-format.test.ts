import { describe, expect, it } from "vitest";
import { agoText, dueLabel, formatWorkDay, groupTitle, initials, overdueText, personTone, workViewDefaults } from "./work-format";

const today = "2026-10-09";

describe("dates", () => {
  it("reads near dates relatively and the rest as a short date", () => {
    expect(dueLabel("2026-10-09", today)).toEqual({ text: "Today", tone: "today" });
    expect(dueLabel("2026-10-10", today)).toEqual({ text: "Tomorrow", tone: "soon" });
    expect(dueLabel("2026-10-08", today)).toEqual({ text: "Yesterday", tone: "overdue" });
    expect(dueLabel("2026-10-30", today)).toEqual({ text: "30 Oct", tone: "later" });
    expect(dueLabel("2026-10-01", today, "done").tone).toBe("done");
  });

  it("adds the year only outside the current one", () => {
    expect(formatWorkDay("2027-01-05", today)).toBe("5 Jan 2027");
    expect(formatWorkDay("2026-01-05", today)).toBe("5 Jan");
  });

  it("says how late and how long ago", () => {
    expect(overdueText("2026-10-06", today)).toBe("Overdue by 3 days");
    expect(overdueText("2026-10-08", today)).toBe("Overdue by 1 day");
    const now = new Date("2026-10-09T12:00:00Z");
    expect(agoText("2026-10-09T11:59:30Z", now)).toBe("just now");
    expect(agoText("2026-10-09T10:00:00Z", now)).toBe("2 h ago");
    expect(agoText("2026-10-06T12:00:00Z", now)).toBe("3 days ago");
  });
});

describe("views", () => {
  it("starts each scope from its own defaults", () => {
    expect(workViewDefaults("project").group).toBe("status");
    expect(workViewDefaults("my-tasks").sort.field).toBe("due");
    expect(workViewDefaults("all-tasks").group).toBe("project");
  });

  it("titles groups by their meaning", () => {
    const names = { person: (id: string) => `P:${id}`, project: (id: string) => `X:${id}` };
    expect(groupTitle("status", "in_review", names)).toBe("In review");
    expect(groupTitle("assignee", "none", names)).toBe("Unassigned");
    expect(groupTitle("assignee", "u1", names)).toBe("P:u1");
    expect(groupTitle("due", "week", names)).toBe("Next 7 days");
  });
});

describe("people", () => {
  it("draws a person as two initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("martina.binacci")).toBe("MB");
    expect(initials("demo")).toBe("DE");
    expect(initials("  ")).toBe("?");
  });

  it("keeps one tone per person", () => {
    expect(personTone("user-1")).toBe(personTone("user-1"));
    const tones = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(personTone));
    expect(tones.size).toBeGreaterThan(1);
  });
});
