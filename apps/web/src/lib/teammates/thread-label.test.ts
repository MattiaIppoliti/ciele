import { describe, expect, it } from "vitest";
import { threadEntryLabel } from "./thread-label";

/**
 * A Routine run lands in its author's thread like any other Conversation.
 * Without the label it reads as something they said this morning, which is the
 * opposite of the audit trail persisting the run is for.
 */

describe("threadEntryLabel", () => {
  it("marks an unattended run, using the routine's own name", () => {
    expect(
      threadEntryLabel({
        title: "Triage yesterday's feedback.",
        metadata: { routineId: "rt-1", routineName: "Nightly triage" },
      })
    ).toBe("Routine: Nightly triage");
  });

  it("falls back to the conversation title when the name is missing", () => {
    // An older run, or a routine whose instruction was one long line.
    expect(
      threadEntryLabel({
        title: "Triage yesterday's feedback. Then file the worst.",
        metadata: { routineId: "rt-1" },
      })
    ).toBe("Routine: Triage yesterday's feedback.");
  });

  it("leaves an ordinary conversation alone", () => {
    expect(threadEntryLabel({ title: "How do I publish?" })).toBe(
      "How do I publish?"
    );
    expect(threadEntryLabel({ title: "", metadata: {} })).toBe(
      "Untitled conversation"
    );
  });
});
