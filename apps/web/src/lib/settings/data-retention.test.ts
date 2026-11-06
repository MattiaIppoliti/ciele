import { describe, expect, it } from "vitest";
import type { Organization } from "@agent-hub/core";
import {
  describeDays,
  initialRetentionState,
  isRowDirty,
  RETENTION_ROWS,
  retentionSubmission,
  rowError,
} from "./data-retention";

const org = (overrides: Partial<Organization> = {}): Organization => ({
  id: "org-1",
  name: "Acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("data retention form", () => {
  it("starts with every switch off and audit records at the 180-day default", () => {
    const state = initialRetentionState(org());
    expect(state.conversations).toEqual({ enabled: false, amount: "1", unit: "years" });
    expect(state.audit).toEqual({ enabled: true, amount: "6", unit: "months" });
    expect(retentionSubmission(org(), state)).toEqual({ patch: {}, deletes: [] });
  });

  it("reads stored windows in their largest unit", () => {
    const state = initialRetentionState(
      org({ transcriptRetentionDays: 90, messageRetentionDays: 45, auditRetentionDays: 730 })
    );
    expect(state.conversations).toEqual({ enabled: true, amount: "3", unit: "months" });
    expect(state.messages).toEqual({ enabled: true, amount: "45", unit: "days" });
    expect(state.audit).toEqual({ enabled: true, amount: "2", unit: "years" });
  });

  it("refuses a window under a month or over five years", () => {
    expect(rowError({ enabled: true, amount: "2", unit: "days" })).toMatch(/1 month and 5 years/);
    expect(rowError({ enabled: true, amount: "6", unit: "years" })).toMatch(/1 month and 5 years/);
    expect(rowError({ enabled: true, amount: "", unit: "years" })).toMatch(/1 month and 5 years/);
    // A switched-off row is never invalid: nothing is deleted.
    expect(rowError({ enabled: false, amount: "2", unit: "days" })).toBeNull();
    const state = initialRetentionState(org());
    state.conversations = { enabled: true, amount: "2", unit: "days" };
    expect(retentionSubmission(org(), state)).toBeNull();
  });

  it("sends only what changed, and flags windows that start deleting", () => {
    const current = org({ transcriptRetentionDays: 365, improvementRetentionDays: 90 });
    const state = initialRetentionState(current);
    state.conversations = { enabled: true, amount: "6", unit: "months" };
    state.improvements = { enabled: false, amount: "3", unit: "months" };
    state.messages = { enabled: true, amount: "1", unit: "years" };
    const submission = retentionSubmission(current, state);
    expect(submission?.patch).toEqual({
      transcriptRetentionDays: 180,
      messageRetentionDays: 365,
      improvementRetentionDays: null,
    });
    // Shortened and newly switched on delete; switching off deletes nothing.
    expect(submission?.deletes).toEqual([
      { noun: "conversations", days: 180 },
      { noun: "messages", days: 365 },
    ]);
  });

  it("writes the audit window and confirms when it shrinks", () => {
    const state = initialRetentionState(org());
    state.audit = { enabled: true, amount: "1", unit: "months" };
    expect(retentionSubmission(org(), state)).toEqual({
      patch: { auditRetentionDays: 30 },
      deletes: [{ noun: "audit records", days: 30 }],
    });
  });

  it("marks a row dirty against what is stored", () => {
    const current = org({ messageRetentionDays: 30 });
    const spec = RETENTION_ROWS.find((row) => row.type === "messages")!;
    expect(isRowDirty(current, spec, { enabled: true, amount: "1", unit: "months" })).toBe(false);
    expect(isRowDirty(current, spec, { enabled: true, amount: "30", unit: "days" })).toBe(false);
    expect(isRowDirty(current, spec, { enabled: false, amount: "1", unit: "months" })).toBe(true);
  });

  it("spells a window for people", () => {
    expect(describeDays(365)).toBe("1 year");
    expect(describeDays(90)).toBe("3 months");
    expect(describeDays(31)).toBe("31 days");
  });
});
