import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import {
  ROUTINE_OVERFETCH_MS,
  isRoutineDue,
  routineConversationMetadata,
  routineTitle,
  thrownMessage,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { drain } from "./drain";
import { alertKeys, signalHealth } from "./health";
import { streamConversationTurn } from "./turn";
import type { TeammateActionTool } from "./types";

/**
 * The Routine runner (#772): unattended Teammate work, on a cron tick.
 *
 * Three properties this is built around, in the order they matter.
 *
 * **It runs once per window.** The over-fetch is deliberately loose and the
 * exact rule (`isRoutineDue`) is pure, so the drain reads a few rows it will
 * not run rather than encoding a schedule in SQL. The claim is then a
 * compare-and-set on the lease the caller read: two overlapping ticks race,
 * one wins, and the loser gets null instead of a second run.
 *
 * **It runs at the hour somebody asked for, when the tick allows it.** This has
 * its own cron rather than riding the nightly crawl finalizer, because only a
 * tick that fires more often than once a day can honour a preferred hour: on a
 * daily tick every routine runs at the tick's own hour whatever its author
 * chose, since the slot rule says "yesterday's slot has passed" and it is right.
 * How often the tick fires is the deployment's to decide (hourly on a
 * self-host, daily on Vercel's Hobby plan, which refuses anything more
 * frequent), and nothing in here changes with it.
 *
 * **One organization cannot take the whole tick.** Rows arrive oldest-lease
 * first, so an org with a backlog would fill the run budget and everybody else
 * would wait for a tick with room. The due rows are interleaved by organization
 * and what does not fit is counted, not dropped: a silent truncation reads as
 * "nothing else was waiting".
 *
 * **It runs as nobody.** No invoking Member, so no `keyResolution.memberId`,
 * which is what keeps an unattended run off a Member's personal subscription
 * (ADR-0007 as amended by #769) and on the Organization's connections. The
 * Teammate acts purely on its own grants: whatever the host's action port
 * hands over, and nothing else. A Teammate with no grants can only write a
 * report of what it would have done.
 *
 * **Every run leaves the same trail as a chat.** It goes through
 * `streamConversationTurn`, the real turn, so the Conversation, the tool cards
 * and the trace are the ones a Member would have got by typing the
 * instruction. The stream is drained and discarded; nobody is watching, but
 * persistence rides the same path as the bytes.
 */

export interface RoutineRunnerDeps {
  db: Db;
  /**
   * What this Teammate may do, from its grant rows (#770). A host port because
   * the runtime does not know operations exist; unwired, a routine can talk and
   * search and nothing else, which is a correct routine rather than a broken one.
   */
  teammateActions?: (
    teammate: Teammate
  ) => Promise<readonly TeammateActionTool[]>;
}

export interface RoutineRunReport {
  /** Rows the over-fetch returned, before the exact rule. */
  candidates: number;
  /** Routines this tick claimed and ran. */
  ran: number;
  /** Of those, how many ended in an Alert. */
  failed: number;
  /**
   * Due routines this tick had no budget for. They stay due and the next tick
   * takes them; counted so a starved queue is visible in the report rather than
   * looking like an empty one.
   */
  deferred: number;
}

/**
 * How many rows to read per run slot.
 *
 * The interleave can only be fair about rows it was given, and the query
 * returns them oldest-lease first, so reading exactly the budget would hand a
 * backlogged org every slot before the fairness pass ever saw a second
 * organization. Four covers a lopsided tick without turning the drain into a
 * full-table read.
 */
const CANDIDATE_ROWS_PER_SLOT = 4;

/**
 * Due routines, one organization at a time, until the budget runs out.
 *
 * Round-robin over the organizations present, each in its own oldest-lease
 * order, so a hundred due routines in one org cost everybody else a place in
 * the queue rather than the whole tick.
 */
function interleaveByOrganization(
  due: readonly TeammateRoutine[]
): TeammateRoutine[] {
  const byOrg = new Map<string, TeammateRoutine[]>();
  for (const routine of due) {
    const queue = byOrg.get(routine.organizationId);
    if (queue) queue.push(routine);
    else byOrg.set(routine.organizationId, [routine]);
  }
  const queues = [...byOrg.values()];
  const ordered: TeammateRoutine[] = [];
  for (let round = 0; ordered.length < due.length; round += 1) {
    for (const queue of queues) {
      const routine = queue[round];
      if (routine) ordered.push(routine);
    }
  }
  return ordered;
}

export async function runDueRoutines(
  deps: RoutineRunnerDeps,
  options: { now?: Date; limit?: number } = {}
): Promise<RoutineRunReport> {
  const now = options.now ?? new Date();
  const budget = options.limit ?? 20;
  const candidates = await deps.db.listDueRoutineCandidates({
    // The loosest window any cadence can be due within: everything weekly or
    // monthly is far older than this, so one cutoff covers all three. It holds
    // because a run lands close to the tick that claimed it, and consecutive
    // daily slots are 24 hours apart: on an hourly tick within an hour of the
    // slot, on a daily tick at the same time every day. A tick that fired
    // hours late for the last two days in a row could push a routine past this
    // cutoff and skip it for one period.
    before: new Date(now.getTime() - ROUTINE_OVERFETCH_MS).toISOString(),
    limit: budget * CANDIDATE_ROWS_PER_SLOT,
  });

  const report: RoutineRunReport = {
    candidates: candidates.length,
    ran: 0,
    failed: 0,
    deferred: 0,
  };

  const due = candidates.filter((candidate) => isRoutineDue(candidate, now));
  for (const candidate of interleaveByOrganization(due)) {
    if (report.ran >= budget) {
      // Out of budget, not out of work. It stays due, the next tick takes it,
      // and the count says so.
      report.deferred += 1;
      continue;
    }
    const claimed = await deps.db.claimTeammateRoutine(
      candidate.id,
      candidate.lastRunAt,
      now.toISOString()
    );
    // Another tick got there first. Not an error, and not worth a log line:
    // it is the lease doing its job.
    if (!claimed) continue;

    report.ran += 1;
    const outcome = await runOneRoutine(deps, claimed);
    if (!outcome.ok) report.failed += 1;
  }
  return report;
}

async function runOneRoutine(
  deps: RoutineRunnerDeps,
  routine: TeammateRoutine
): Promise<{ ok: boolean }> {
  const { db } = deps;
  let detail = "";
  let ok = false;
  try {
    detail = await executeRoutine(deps, routine);
    ok = true;
  } catch (error) {
    detail = thrownMessage(error, "The run failed");
  }

  await db
    .recordTeammateRoutineRun(routine.id, {
      status: ok ? "ok" : "failed",
      detail,
    })
    .catch((error) => {
      console.error("[routines] run record failed:", error);
    });

  // A failure raises an Alert keyed on the routine; the next success resolves
  // it. Silent breakage is the failure mode that matters here: nobody is
  // watching a nightly job, so a routine that stopped working has to say so.
  await signalHealth(
    db,
    routine.organizationId,
    ok
      ? { healthy: true, key: alertKeys.routine(routine.id) }
      : {
          healthy: false,
          key: alertKeys.routine(routine.id),
          alert: {
            // `system`: not an integration, a crawl, a provider or a knowledge
            // problem. A routine that failed is the platform's own scheduled
            // work not completing.
            type: "system",
            title: `Routine failed: ${routineTitle(routine.instruction)}`,
            detail: `${detail} It runs again on the next ${routine.cadence} cycle, and this alert clears when it succeeds.`,
          },
        },
    "routines"
  );
  return { ok };
}

/** One run, through the real turn. Returns the line the run record keeps. */
async function executeRoutine(
  deps: RoutineRunnerDeps,
  routine: TeammateRoutine
): Promise<string> {
  const { db } = deps;
  const teammate = await db.table("teammates").get(routine.teammateId);
  if (!teammate || teammate.organizationId !== routine.organizationId) {
    throw new Error("The teammate this routine belongs to is gone");
  }
  // A retired Teammate answers nothing more (#767), including on a schedule.
  // Not an error: somebody deleted it on purpose, and an Alert would be
  // telling them off for a decision they made.
  if (teammate.deletedAt) return "Skipped: this teammate was deleted";

  const [connections, actions] = await Promise.all([
    db.listProviderConnections(routine.organizationId),
    deps.teammateActions?.(teammate) ?? Promise.resolve([]),
  ]);

  const stream = await streamConversationTurn({
    db,
    teammate,
    teammateActions: actions,
    connections,
    organizationId: routine.organizationId,
    subjectType: "member",
    // The author's thread: "you set this up, here is what it did". Empty when
    // their account is gone, which orphans the Conversation rather than
    // attributing it to somebody who never asked for it.
    subjectId: routine.createdBy ?? "",
    message: routine.instruction,
    // Marks the Conversation as unattended, so the thread labels it instead of
    // rendering it as something the author said this morning (#772, story 26).
    metadata: routineConversationMetadata(routine),
    // No `keyResolution`: unattended work runs on Organization connections.
    signal: new AbortController().signal,
  });

  await drain(stream);
  return actions.length > 0
    ? `Ran with ${actions.length} action${actions.length === 1 ? "" : "s"} available`
    : "Ran with no granted actions";
}

/**
 * Read the turn to completion and throw the bytes away.
 *
 * Nobody is watching, but the turn persists as it streams, so draining is how
 * an unattended run gets the same Conversation, tool cards and trace an
 * attended one gets. Reusing the streaming entrypoint rather than adding a
 * second headless path is the whole reason the audit trails match.
 */
// The mechanics are shared with the two gate continuations (`drain.ts`).
