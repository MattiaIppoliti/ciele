"use server";

import type { MemoryDocument } from "@agent-hub/core";
import { revertMyMemoryOp, writeMyMemoryOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * The Member's own memory document (#771).
 *
 * Neither action takes a member id. The operation derives it from the session,
 * so there is no shape of call, from this surface or any other, that writes a
 * colleague's profile (#767, story 19).
 */

export async function writeMyMemoryAction(
  body: string,
  note = ""
): Promise<MemoryDocument> {
  return runOperation(writeMyMemoryOp, { body, note });
}

/** Undo one write, back to the body it replaced. */
export async function revertMyMemoryAction(
  entryId: string
): Promise<MemoryDocument> {
  return runOperation(revertMyMemoryOp, { entryId });
}
