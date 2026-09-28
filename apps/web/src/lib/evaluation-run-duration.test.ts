import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVALUATION_RUN_STALE_MS } from "@agent-hub/core";

/**
 * A run is read as failed after `EVALUATION_RUN_STALE_MS` without a write,
 * which is only safe while no runner can still be alive by then. The runner is
 * the Server Action, which inherits the Eval page's `maxDuration`. Next reads
 * that export statically, so it must stay a literal and this test reads it
 * from the source rather than importing the page.
 */
describe("the Eval run deadline", () => {
  it("ends before a silent run is read as failed", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../app/(admin)/eval/page.tsx"),
      "utf8",
    );
    const match = /export const maxDuration = (\d+);/.exec(page);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 1000).toBeLessThan(EVALUATION_RUN_STALE_MS);
  });
});
