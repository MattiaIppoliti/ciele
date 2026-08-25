import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./turn")>()),
  streamConversationTurn: vi.fn(),
}));

import { isRoutineConversation } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { streamConversationTurn } from "./turn";
import { runDueRoutines } from "./routine-runner";

/**
 * The unattended Routine runner (#772).
 *
 * Everything here is about the run *not* happening twice, not happening as
 * somebody, and not failing silently. The schedule itself is tested in the
 * domain package; these are the runner's own guarantees.
 */

const turn = vi.mocked(streamConversationTurn);

/** A stream that ends immediately: the turn under test is mocked out. */
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

async function seedRoutine(
  db: Db,
  over: Record<string, unknown> = {},
  organizationId: string = DEMO_ORG.id
) {
  const teammate = await db.table("teammates").insert({
    organizationId,
    ownerId: DEMO_MEMBER.userId,
    name: "Nora",
  });
  const routine = await db.table("teammateRoutines").insert({
    organizationId,
    teammateId: teammate.id,
    instruction: "Triage yesterday's visitor feedback.",
    cadence: "daily",
    hour: 8,
    createdBy: DEMO_MEMBER.userId,
    ...over,
  });
  return { teammate, routine };
}

/** Well past the routine's creation, and after an 08:00 slot. */
const RUN_AT = new Date("2026-09-01T09:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  turn.mockResolvedValue(emptyStream());
});

describe("runDueRoutines", () => {
  it("runs a due routine once and stamps the lease", async () => {
    const db = getMockDb();
    const { routine } = await seedRoutine(db);

    const report = await runDueRoutines({ db }, { now: RUN_AT });
    expect(report.ran).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBe(0);

    const after = await db.table("teammateRoutines").get(routine.id);
    expect(after?.lastRunAt).toBe(RUN_AT.toISOString());
    expect(after?.lastStatus).toBe("ok");
  });

  it("does not run it again inside the same slot", async () => {
    const db = getMockDb();
    await seedRoutine(db);
    await runDueRoutines({ db }, { now: RUN_AT });
    turn.mockClear();

    // A second tick 50 minutes later: the slot has not turned over.
    await runDueRoutines({ db }, { now: new Date("2026-09-01T09:50:00.000Z") });
    expect(turn).not.toHaveBeenCalled();
  });

  it("skips a disabled routine even when its window is long past", async () => {
    const db = getMockDb();
    const { routine } = await seedRoutine(db);
    await db.table("teammateRoutines").update(routine.id, { enabled: false });
    const report = await runDueRoutines({ db }, { now: RUN_AT });
    expect(
      (await db.table("teammateRoutines").get(routine.id))?.lastRunAt
    ).toBeNull();
    expect(report.failed).toBe(0);
  });

  it("runs as nobody: no member key resolution, so no personal subscription", async () => {
    const db = getMockDb();
    await seedRoutine(db);
    await runDueRoutines({ db }, { now: RUN_AT });

    const input = turn.mock.calls[0][0];
    // ADR-0007 as amended by #769 lets a personal plan power its owner's own
    // turns. This is not one of those, and the absence is the enforcement.
    expect(input.keyResolution).toBeUndefined();
    expect(input.message).toBe("Triage yesterday's visitor feedback.");
  });

  it("marks the Conversation as unattended, in the author's thread", async () => {
    const db = getMockDb();
    const { routine } = await seedRoutine(db);
    await runDueRoutines({ db }, { now: RUN_AT });

    const input = turn.mock.calls[0][0];
    expect(input.subjectId).toBe(DEMO_MEMBER.userId);
    expect(input.metadata?.routineId).toBe(routine.id);
    // Without the marker the run reads as something the author said this
    // morning, which is the opposite of an audit trail.
    expect(isRoutineConversation(input.metadata)).toBe(true);
  });

  it("hands over exactly the actions its grants bought, and no more", async () => {
    const db = getMockDb();
    await seedRoutine(db);
    const actions = vi.fn().mockResolvedValue([
      { operation: "improvements.triage_feedback" },
    ]);
    await runDueRoutines({ db, teammateActions: actions }, { now: RUN_AT });

    expect(actions).toHaveBeenCalledTimes(1);
    expect(turn.mock.calls[0][0].teammateActions).toHaveLength(1);
  });

  it("runs with no actions at all when the host wires no port", async () => {
    // An unwired deployment gets a routine that can talk and search. That is a
    // correct routine, not a broken one.
    const db = getMockDb();
    await seedRoutine(db);
    await runDueRoutines({ db }, { now: RUN_AT });
    expect(turn.mock.calls[0][0].teammateActions).toEqual([]);
  });

  it("raises an Alert when a run fails, and clears it on the next success", async () => {
    // The mock store is shared across this file, so earlier routines are still
    // due. Assert on this routine's own record and its own Alert rather than
    // on the tick's totals.
    const db = getMockDb();
    const { routine } = await seedRoutine(db, {
      instruction: "The one that breaks.",
    });
    turn.mockImplementation(async (input) =>
      input.message === "The one that breaks."
        ? Promise.reject(new Error("No provider credential"))
        : emptyStream()
    );

    const failed = await runDueRoutines({ db }, { now: RUN_AT });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    const stored = await db.table("teammateRoutines").get(routine.id);
    expect(stored?.lastStatus).toBe("failed");
    expect(stored?.lastDetail).toContain("No provider credential");

    const alerts = await db.listAlerts(DEMO_ORG.id);
    const raised = alerts.find((alert) =>
      alert.title.includes("Routine failed")
    );
    expect(raised?.status).toBe("active");
    // The detail says when it will try again, because a nightly job nobody
    // watches is exactly the one that fails quietly.
    expect(raised?.detail).toContain("daily");

    // Next window, and it works.
    turn.mockImplementation(async () => emptyStream());
    await runDueRoutines({ db }, { now: new Date("2026-09-02T09:00:00.000Z") });
    expect((await db.table("teammateRoutines").get(routine.id))?.lastStatus).toBe(
      "ok"
    );
    const cleared = (await db.listAlerts(DEMO_ORG.id)).find((alert) =>
      alert.title.includes("Routine failed")
    );
    expect(cleared?.status).toBe("resolved");
  });

  it("skips a retired Teammate without calling it a failure", async () => {
    const db = getMockDb();
    const { teammate, routine } = await seedRoutine(db);
    await db
      .table("teammates")
      .update(teammate.id, { deletedAt: new Date().toISOString() });

    const report = await runDueRoutines({ db }, { now: RUN_AT });
    // Somebody deleted the Teammate on purpose. An Alert here would be telling
    // them off for a decision they made.
    expect(report.failed).toBe(0);
    expect(turn).not.toHaveBeenCalled();
    const stored = await db.table("teammateRoutines").get(routine.id);
    expect(stored?.lastStatus).toBe("ok");
    expect(stored?.lastDetail).toContain("deleted");
  });

  it("keeps going when one routine throws", async () => {
    const db = getMockDb();
    const broken = await seedRoutine(db, { instruction: "The broken one." });
    const fine = await seedRoutine(db, { instruction: "The working one." });
    turn.mockImplementation(async (input) =>
      input.message === "The broken one."
        ? Promise.reject(new Error("boom"))
        : emptyStream()
    );

    await runDueRoutines({ db }, { now: RUN_AT });
    // One tick, one broken routine: the other still ran.
    expect(
      (await db.table("teammateRoutines").get(broken.routine.id))?.lastStatus
    ).toBe("failed");
    expect(
      (await db.table("teammateRoutines").get(fine.routine.id))?.lastStatus
    ).toBe("ok");
  });
});

describe("one organization cannot take the whole tick", () => {
  /**
   * The mock Db is a process-wide singleton, so rows other cases left behind
   * are still due here. Running the tick with a budget nothing can exhaust
   * clears them, which is what makes the counts below exact.
   */
  async function drainBacklog(db: Db) {
    await runDueRoutines({ db }, { now: RUN_AT, limit: 1000 });
  }

  it("shares the run budget round-robin instead of first-come", async () => {
    const db = getMockDb();
    await drainBacklog(db);
    // A noisy org with a backlog, and a quiet one with a single routine. Read
    // strictly in order, the loud org's rows fill the budget and the quiet
    // org waits for a tick that may never have room.
    for (let i = 0; i < 6; i += 1) {
      await seedRoutine(db, { instruction: `Loud ${i}.` }, "org-loud");
    }
    const quiet = await seedRoutine(
      db,
      { instruction: "Quiet one." },
      "org-quiet"
    );

    const report = await runDueRoutines({ db }, { now: RUN_AT, limit: 3 });

    expect(report.ran).toBe(3);
    const quietRuns = (
      await db.table("teammateRoutines").list({ organizationId: "org-quiet" })
    ).filter((routine) => routine.lastRunAt !== null);
    expect(quietRuns.map((routine) => routine.id)).toEqual([quiet.routine.id]);
  });

  it("reports what it left for the next tick rather than dropping it quietly", async () => {
    const db = getMockDb();
    await drainBacklog(db);
    for (let i = 0; i < 5; i += 1) {
      await seedRoutine(db, { instruction: `Job ${i}.` }, "org-deferred");
    }
    const report = await runDueRoutines({ db }, { now: RUN_AT, limit: 2 });
    expect(report.ran).toBe(2);
    // Three were due and did not run. A silent truncation reads as "nothing
    // else was waiting", which is how a starved routine goes unnoticed.
    expect(report.deferred).toBe(3);

    // And they are still due: the next tick finishes them.
    const next = await runDueRoutines({ db }, { now: RUN_AT, limit: 10 });
    expect(next.ran).toBe(3);
    expect(next.deferred).toBe(0);
  });
});
