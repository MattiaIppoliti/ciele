import type { CieleClient } from "@ciele/client";
import type { CliDeps } from "../index.ts";

/** What every command-group handler receives from the dispatcher. */
export interface CommandContext {
  client: CieleClient;
  flags: Record<string, FlagValue>;
  /** Positional args after the verb. */
  rest: string[];
  emit: (human: string, data: unknown) => void;
  deps: CliDeps;
}

/**
 * One flag's value. An array is a flag given more than once: the parser
 * collects repeats so a command like `teammates provision` can take several
 * `--routine`s, and everything that never expected a repeat keeps reading the
 * last one through `str()`.
 */
export type FlagValue = string | boolean | Array<string | boolean>;

/** The last string value of a flag, or undefined if it carries none. */
export function str(flag: FlagValue | undefined): string | undefined {
  if (Array.isArray(flag)) {
    const strings = flag.filter((value): value is string => typeof value === "string");
    return strings.length ? strings[strings.length - 1] : undefined;
  }
  return typeof flag === "string" ? flag : undefined;
}

/** Every string value of a flag, in the order it was given. */
export function strList(flag: FlagValue | undefined): string[] {
  if (Array.isArray(flag)) {
    return flag.filter((value): value is string => typeof value === "string");
  }
  return typeof flag === "string" ? [flag] : [];
}

export function usage(deps: CliDeps, hint: string): number {
  deps.stderr(`Usage: ciele ${hint}`);
  return 2;
}
