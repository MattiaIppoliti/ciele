import type { CieleClient } from "@ciele/client";
import type { CliDeps } from "../index.ts";

/** What every command-group handler receives from the dispatcher. */
export interface CommandContext {
  client: CieleClient;
  flags: Record<string, string | boolean>;
  /** Positional args after the verb. */
  rest: string[];
  emit: (human: string, data: unknown) => void;
  deps: CliDeps;
}

export function str(
  flag: string | boolean | undefined
): string | undefined {
  return typeof flag === "string" ? flag : undefined;
}

export function usage(deps: CliDeps, hint: string): number {
  deps.stderr(`Usage: ciele ${hint}`);
  return 2;
}
