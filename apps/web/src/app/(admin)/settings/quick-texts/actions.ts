"use server";

import {
  OperationError,
  createQuickTextOp,
  deleteQuickTextOp,
  updateQuickTextOp,
} from "@ciele/ops";
import type { QuickText } from "@agent-hub/core";
import { CapabilityRefusedError } from "@/lib/authz";
import { runOperation } from "@/lib/operations";

/** Quick Texts settings (#1085); refusals come back as a message to show. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof OperationError || error instanceof CapabilityRefusedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

interface QuickTextFields {
  title: string;
  body: string;
  folder: string | null;
}

export async function createQuickTextAction(input: QuickTextFields): Promise<Result<QuickText>> {
  return attempt(() => runOperation(createQuickTextOp, input));
}

export async function updateQuickTextAction(id: string, patch: QuickTextFields): Promise<Result<QuickText>> {
  return attempt(() => runOperation(updateQuickTextOp, { id, patch }));
}

export async function deleteQuickTextAction(id: string): Promise<Result<null>> {
  return attempt(async () => {
    await runOperation(deleteQuickTextOp, { id });
    return null;
  });
}
