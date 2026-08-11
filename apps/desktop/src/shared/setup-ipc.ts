// The wizard half of the preload bridge.
//
// Separate from state.ts because it is a separate concern with its own
// lifetime: the setup engine only exists in local mode, and its snapshots
// change far more often than the app's settings do.

import type { SetupSnapshot } from "../setup/types";

export type { SetupSnapshot };

export interface SetupBridge {
  setup: {
    getSnapshot(): Promise<SetupSnapshot>;
    onSnapshot(listener: (snapshot: SetupSnapshot) => void): () => void;
    /** Continue: accept the current step and run forward. */
    run(): Promise<SetupSnapshot>;
    retry(): Promise<SetupSnapshot>;
    skip(): Promise<SetupSnapshot>;
    setInput(stepId: string, values: Record<string, string>): Promise<SetupSnapshot>;
    /**
     * Put a settled optional step back on the table — the Back button's teeth.
     * Optional steps only; the ones after it keep their results.
     */
    revisit(stepId: string): Promise<SetupSnapshot>;
    /**
     * Back to a first run: clears the wizard's step state *and* the flag that
     * makes later launches skip it. Does not touch the stack or its data —
     * removing someone's database is not something a button should do.
     */
    reset(): Promise<SetupSnapshot>;
  };
}

export const SETUP_CHANNELS = {
  getSnapshot: "ciele:setup:get-snapshot",
  snapshotChanged: "ciele:setup:snapshot-changed",
  run: "ciele:setup:run",
  retry: "ciele:setup:retry",
  skip: "ciele:setup:skip",
  setInput: "ciele:setup:set-input",
  revisit: "ciele:setup:revisit",
  reset: "ciele:setup:reset",
} as const;
