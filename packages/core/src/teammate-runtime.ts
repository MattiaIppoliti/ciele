import type { Teammate, TeammateRuntimeConfig } from "./types";

/** Missing configuration (including an older database) grants no execution. */
export function teammateRuntimeConfig(
  teammate: Pick<Teammate, "runtimeConfig">,
): TeammateRuntimeConfig {
  return (
    teammate.runtimeConfig ?? {
      harness: { kind: "ciele" },
      internet: false,
      computer: { browser: false, files: false, terminal: false },
    }
  );
}
