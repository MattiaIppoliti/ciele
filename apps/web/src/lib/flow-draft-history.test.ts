import { describe, expect, it } from "vitest";
import {
  DRAFT_COALESCE_MS,
  DRAFT_HISTORY_LIMIT,
  canRedo,
  canUndo,
  createDraftHistory,
  recordDraft,
  redoDraft,
  undoDraft,
} from "./flow-draft-history";

/** One undo history shared by the form, the canvas and the Flows Agent (#837). */

describe("flow draft history", () => {
  it("starts with nothing to undo or redo", () => {
    const history = createDraftHistory({ name: "" });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("records a step, undoes it and redoes it", () => {
    let history = createDraftHistory({ name: "a" });
    history = recordDraft(history, { name: "b" });
    expect(history.present).toEqual({ name: "b" });
    expect(canUndo(history)).toBe(true);

    history = undoDraft(history);
    expect(history.present).toEqual({ name: "a" });
    expect(canRedo(history)).toBe(true);

    history = redoDraft(history);
    expect(history.present).toEqual({ name: "b" });
    expect(canRedo(history)).toBe(false);
  });

  it("ignores a record of the same present", () => {
    const history = createDraftHistory({ name: "a" });
    expect(recordDraft(history, history.present)).toBe(history);
  });

  it("discards the redo future on a new edit", () => {
    let history = createDraftHistory({ name: "a" });
    history = recordDraft(history, { name: "b" });
    history = undoDraft(history);
    history = recordDraft(history, { name: "c" });
    expect(canRedo(history)).toBe(false);
    expect(undoDraft(history).present).toEqual({ name: "a" });
  });

  it("coalesces keystrokes on the same field inside the window", () => {
    let history = createDraftHistory({ name: "" });
    history = recordDraft(history, { name: "h" }, { key: "name", now: 1000 });
    history = recordDraft(history, { name: "he" }, { key: "name", now: 1200 });
    history = recordDraft(history, { name: "hel" }, { key: "name", now: 1400 });
    expect(history.past).toHaveLength(1);
    expect(undoDraft(history).present).toEqual({ name: "" });
  });

  it("starts a new step once the window has passed or the field changes", () => {
    let history = createDraftHistory({ name: "", message: "" });
    history = recordDraft(history, { name: "a", message: "" }, { key: "name", now: 1000 });
    history = recordDraft(
      history,
      { name: "ab", message: "" },
      { key: "name", now: 1000 + DRAFT_COALESCE_MS + 1 }
    );
    history = recordDraft(
      history,
      { name: "ab", message: "x" },
      { key: "message", now: 1000 + DRAFT_COALESCE_MS + 2 }
    );
    expect(history.past).toHaveLength(3);
  });

  it("does not coalesce across an undo", () => {
    let history = createDraftHistory({ name: "" });
    history = recordDraft(history, { name: "a" }, { key: "name", now: 1000 });
    history = undoDraft(history);
    history = recordDraft(history, { name: "b" }, { key: "name", now: 1100 });
    expect(history.past).toHaveLength(1);
    expect(undoDraft(history).present).toEqual({ name: "" });
  });

  it("caps the past at the history limit", () => {
    let history = createDraftHistory(0);
    for (let i = 1; i <= DRAFT_HISTORY_LIMIT + 20; i += 1) {
      history = recordDraft(history, i);
    }
    expect(history.past).toHaveLength(DRAFT_HISTORY_LIMIT);
    expect(history.past[0]).toBe(20);
  });

  it("undo and redo at the boundaries are no-ops", () => {
    const history = createDraftHistory({ name: "a" });
    expect(undoDraft(history)).toBe(history);
    expect(redoDraft(history)).toBe(history);
  });
});
