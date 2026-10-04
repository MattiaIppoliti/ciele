import { z } from "zod";
import type { TurnStep } from "@agent-hub/core";

export const computerStatusSchema = z.object({
  state: z.enum(["running", "stopped", "not_configured", "unavailable"]),
  permissions: z.object({
    browser: z.boolean(),
    files: z.boolean(),
    terminal: z.boolean(),
  }),
  canManage: z.boolean().default(false),
});
export const computerScreenSchema = z.object({
  base64: z
    .string()
    .min(1)
    .max(2 * 1024 * 1024)
    .regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  capturedAt: z.string().datetime(),
  url: z.string().max(8192),
});
export const computerFilesSchema = z.object({
  path: z.string(),
  entries: z
    .array(
      z.object({
        path: z.string(),
        kind: z.enum(["file", "folder"]),
        bytes: z.number().optional(),
      }),
    )
    .max(500),
  truncated: z.boolean(),
});
export const computerFileSchema = z.object({
  path: z.string(),
  text: z.string().max(100000),
  truncated: z.boolean(),
  bytes: z.number(),
});
export type ComputerStatus = z.infer<typeof computerStatusSchema>;
export type ComputerScreen = z.infer<typeof computerScreenSchema>;

/** Only show the computer tools' already-redacted operational receipts, never reasoning. */
export function computerActivity(steps: readonly TurnStep[]) {
  return steps.filter(
    (step) => step.kind === "tool" && /^(computer[._])/.test(step.tool ?? ""),
  );
}
export function terminalActivity(steps: readonly TurnStep[]) {
  return computerActivity(steps).filter(
    (step) => step.tool === "computer_exec" || step.tool === "computer.exec",
  );
}

/** One screen card per computer turn. Stored unfinished calls never advertise a live run. */
export function computerTurnActivity(
  steps: readonly TurnStep[],
  { latestCallId, live }: { latestCallId: string | undefined; live: boolean },
) {
  const calls = computerActivity(steps);
  const first = calls.at(0);
  const last = calls.at(-1);
  if (!first || !last) return null;
  const running = live ? calls.findLast(step => step.status === "running") : undefined;
  const step = running ?? last;
  return {
    id: first.id,
    step,
    current: last.id === latestCallId,
    live: Boolean(running),
    status: step.status === "running"
      ? (live ? "Running" : "Interrupted")
      : step.status === "error" ? "Failed" : "Completed",
  };
}
