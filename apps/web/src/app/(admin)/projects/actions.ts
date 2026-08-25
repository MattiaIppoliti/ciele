"use server";

import type { MemoryDocument, Project, ProjectPatch } from "@agent-hub/core";
import {
  createProjectOp,
  deleteProjectOp,
  updateProjectOp,
  writeProjectDocumentOp,
} from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * Projects (#771). Thin adapters over the operations, like every other domain:
 * the behaviour, the capability and the revalidation targets are declared
 * there, so the /api/v1 twin of any of these would do the same thing.
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

/** The conventions-and-decisions document every attached Teammate reads. */
export async function writeProjectDocumentAction(
  id: string,
  body: string,
  note = ""
): Promise<MemoryDocument> {
  return runOperation(writeProjectDocumentOp, { id, body, note });
}
