import type { Db, RuntimeEventInput } from "@agent-hub/db";

/**
 * Runtime telemetry (ADR-0011: AI observability within budget).
 *
 * The one way runtime code writes the `runtime_events` sink: isolated exactly
 * like the AI usage ledger (see usage.ts) so a telemetry failure never breaks
 * or slows the work that was already done — a Visitor's turn always completes
 * even when the sink is down. Failures are logged, never thrown.
 */
export async function recordRuntimeEvent(
  db: Db,
  event: RuntimeEventInput
): Promise<void> {
  try {
    await db.recordRuntimeEvent(event);
  } catch (error) {
    console.error("[runtime] telemetry persist failed:", error);
  }
}

/** The error class recorded for a failed turn — never a silent failure. */
export function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
}

/**
 * A human-readable message for any thrown value. AI SDK stream errors and
 * provider results are often plain objects, so `String(error)` degrades to
 * "[object Object]" and hides the real cause — walk common shapes and fall
 * back to JSON so Preview diagnostics stay legible.
 */
export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause && error.cause !== error
        ? ` (cause: ${errorMessageOf(error.cause)})`
        : "";
    return `${error.message || error.name || "Error"}${cause}`;
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") return errorMessageOf(value);
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // Circular or otherwise non-serializable — fall through.
    }
  }
  return "unknown error";
}
