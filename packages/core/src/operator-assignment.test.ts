import { describe, expect, it } from "vitest";
import { deskHasAvailableOperator, pickOperator, effectiveOperatorStatus, OPERATOR_PRESENCE_LEASE_MS } from "./operator-assignment";

const operators = [
  { memberId: "ana", capacity: 3 },
  { memberId: "ben", capacity: 3 },
  { memberId: "cy", capacity: 1 },
];

describe("pickOperator", () => {
  it("picks the Available operator with the fewest Conversations", () => {
    expect(
      pickOperator({
        operators,
        available: new Set(["ana", "ben"]),
        load: new Map([["ana", 2], ["ben", 1]]),
        lastAssignedAt: new Map(),
      })
    ).toBe("ben");
  });

  it("skips Away operators and operators at capacity", () => {
    expect(
      pickOperator({
        operators,
        available: new Set(["ben", "cy"]),
        load: new Map([["ben", 3], ["cy", 0]]),
        lastAssignedAt: new Map(),
      })
    ).toBe("cy");
  });

  it("breaks a tie by who was assigned least recently, never-assigned first", () => {
    const base = { operators, available: new Set(["ana", "ben"]), load: new Map<string, number>() };
    expect(
      pickOperator({
        ...base,
        lastAssignedAt: new Map([["ana", "2026-10-21T09:00:00Z"], ["ben", "2026-10-21T08:00:00Z"]]),
      })
    ).toBe("ben");
    expect(pickOperator({ ...base, lastAssignedAt: new Map([["ben", "2026-10-21T08:00:00Z"]]) })).toBe("ana");
  });

  it("returns nobody when everyone is Away or full, so the Conversation waits unassigned", () => {
    expect(
      pickOperator({ operators, available: new Set(), load: new Map(), lastAssignedAt: new Map() })
    ).toBeNull();
    expect(
      pickOperator({
        operators,
        available: new Set(["cy"]),
        load: new Map([["cy", 1]]),
        lastAssignedAt: new Map(),
      })
    ).toBeNull();
  });
});

describe("deskHasAvailableOperator", () => {
  it("offers the channel only while somebody on the desk is Available", () => {
    expect(deskHasAvailableOperator(operators, new Set(["ben"]))).toBe(true);
    expect(deskHasAvailableOperator(operators, new Set(["someone-else"]))).toBe(false);
    expect(deskHasAvailableOperator([], new Set(["ben"]))).toBe(false);
  });
});

it("treats closed or expired console leases as Away and preserves explicit Away", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  expect(effectiveOperatorStatus({ status: "available", updatedAt: now.toISOString() }, now)).toBe("available");
  expect(effectiveOperatorStatus({ status: "available", updatedAt: new Date(now.getTime() - OPERATOR_PRESENCE_LEASE_MS).toISOString() }, now)).toBe("away");
  expect(effectiveOperatorStatus({ status: "away", updatedAt: now.toISOString() }, now)).toBe("away");
});
