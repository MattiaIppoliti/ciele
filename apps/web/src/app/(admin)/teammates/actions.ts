"use server";

import type {
  MemoryDocument,
  Project,
  ProjectPatch,
  RoutineCadence,
  Teammate,
  TeammateCapabilityCeiling,
  TeammateGrantDomain,
  TeammatePatch,
  TeammateRoutine,
  TeammateRoutinePatch,
} from "@agent-hub/core";
import {
  createProjectOp,
  createRoutineOp,
  createTeammateOp,
  deleteProjectOp,
  deleteRoutineOp,
  deleteTeammateOp,
  getProjectOp,
  getTeammateMemoryOp,
  hideTeammateOp,
  listTeammateThreadOp,
  readTeammateConversationOp,
  setTeammateGrantsOp,
  startReferralOp,
  unhideTeammateOp,
  updateProjectOp,
  updateRoutineOp,
  updateTeammateOp,
  writeProjectDocumentOp,
  writeTeammateMemoryOp,
  type MemoryDocumentView,
  type TeammateGovernance,
} from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * Teammates mutations (#768). Thin adapters: the behaviour, the ownership rule
 * and the revalidation targets all come from the operation, so the /api/v1 twin
 * of any of these would do exactly the same thing.
 */

export async function createTeammateAction(input: {
  name: string;
  title?: string;
  roleDescription?: string;
  visibility?: "org" | "private";
  collectionIds?: string[];
}): Promise<Teammate> {
  return runOperation(createTeammateOp, input);
}

export async function updateTeammateAction(
  id: string,
  patch: TeammatePatch
): Promise<Teammate> {
  return runOperation(updateTeammateOp, { id, patch });
}

export async function deleteTeammateAction(id: string): Promise<void> {
  await runOperation(deleteTeammateOp, { id });
}

/**
 * Keep a Teammate off your own roster (#767, story 10).
 *
 * Deliberately not next to `deleteTeammateAction` in anybody's mind: deleting
 * retires the Teammate for the whole Organization, this shortens one list. The
 * operation's capability is `member` for that reason.
 */
export async function hideTeammateAction(id: string): Promise<void> {
  await runOperation(hideTeammateOp, { id });
}

export async function unhideTeammateAction(id: string): Promise<void> {
  await runOperation(unhideTeammateOp, { id });
}

/**
 * What this Teammate may do (#770).
 *
 * A separate action from `updateTeammateAction` because it is a separate
 * decision with a separate capability: the operation declares `manageMembers`,
 * so `runOperation` refuses an Editor here while still letting them rename the
 * Teammate through the action above.
 */
export async function setTeammateGrantsAction(
  id: string,
  governance: {
    domains: TeammateGrantDomain[];
    ceiling: TeammateCapabilityCeiling;
    approvalBypass: boolean;
  }
): Promise<TeammateGovernance> {
  return runOperation(setTeammateGrantsOp, { id, ...governance });
}

/**
 * What this Teammate has learned, as of now (#771, story 21).
 *
 * The Configure dialog reads this on open instead of taking it from the page's
 * props. The Teammate appends to the same document on its own, from the job
 * ledger at the end of a conversation, and nothing on an open page re-renders
 * when it does; a prop is therefore only as fresh as the last time the router
 * fetched the page, and saving the editor would put that back over the
 * Teammate's write. `member` capability, because reading a colleague's notes
 * is not editing them.
 */
export async function readTeammateMemoryAction(
  id: string
): Promise<MemoryDocumentView> {
  return runOperation(getTeammateMemoryOp, { id });
}

/**
 * Correct what a Teammate learned (#771, story 21).
 *
 * `edit` capability plus the ownership rule the persona takes, because a wrong
 * learning is fixed by whoever maintains the Teammate. The Teammate's own
 * appends do not come through here; they run from the job ledger.
 */
export async function writeTeammateMemoryAction(
  id: string,
  body: string,
  note = ""
): Promise<MemoryDocument> {
  return runOperation(writeTeammateMemoryOp, { id, body, note });
}

/**
 * Routines (#772): standing instructions the Teammate carries out unattended.
 *
 * `edit` capability plus the Teammate's own ownership rule, enforced in the
 * operation. Giving an agent something to do while nobody is watching is not a
 * different kind of decision from configuring what it is.
 */
export async function createRoutineAction(input: {
  teammateId: string;
  instruction: string;
  cadence: RoutineCadence;
  hour: number;
}): Promise<TeammateRoutine> {
  return runOperation(createRoutineOp, input);
}

export async function updateRoutineAction(
  id: string,
  patch: TeammateRoutinePatch
): Promise<TeammateRoutine> {
  return runOperation(updateRoutineOp, { id, patch });
}

export async function deleteRoutineAction(id: string): Promise<void> {
  await runOperation(deleteRoutineOp, { id });
}

/** This Member's own thread with one Teammate, for the chat's history list. */
export async function listTeammateThreadAction(id: string) {
  return runOperation(listTeammateThreadOp, { id });
}

/** One past conversation with this Teammate, reopened in the chat. */
export async function readTeammateConversationAction(
  id: string,
  conversationId: string
) {
  return runOperation(readTeammateConversationOp, { id, conversationId });
}

/**
 * Accept a referral (#773): open a conversation with the colleague another
 * Teammate suggested, carrying the summary it wrote.
 *
 * The click is what makes this happen; nothing runs until a person decides.
 * Both conversations record the link, so a handoff is a fact in the data
 * rather than a coincidence of timing between two threads.
 */
export async function startReferredConversationAction(input: {
  originConversationId: string;
  teammateId: string;
  summary: string;
}): Promise<{ conversationId: string }> {
  return runOperation(startReferralOp, input);
}

/**
 * Projects (#771), managed from the Teammate configuration panel since they
 * lost their own page: a Project is only ever read by one Teammate, so it is
 * created, attached and edited beside the Teammate that reads it. Thin
 * adapters over the operations, like everything above.
 */

export async function createProjectAction(input: {
  name: string;
  description?: string;
}): Promise<Project> {
  return runOperation(createProjectOp, {
    name: input.name,
    description: input.description ?? "",
  });
}

export async function updateProjectAction(
  id: string,
  patch: ProjectPatch
): Promise<Project> {
  return runOperation(updateProjectOp, { id, patch });
}

export async function deleteProjectAction(id: string): Promise<void> {
  await runOperation(deleteProjectOp, { id });
}

/**
 * One Project with its decisions document and the history of writes to it
 * (#767, story 24): the configuration panel reads this when a Project is
 * selected, so the versioning is answerable from wherever the Project is
 * edited rather than from whichever transcript a decision happened in.
 */
export async function readProjectAction(id: string): Promise<
  { project: Project } & MemoryDocumentView
> {
  return runOperation(getProjectOp, { id });
}

/** The conventions-and-decisions document every attached Teammate reads. */
export async function writeProjectDocumentAction(
  id: string,
  body: string,
  note = ""
): Promise<MemoryDocument> {
  return runOperation(writeProjectDocumentOp, { id, body, note });
}
