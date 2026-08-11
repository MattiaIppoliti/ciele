// The compose invocation the whole app uses, in one place.
//
// Both the wizard's steps and the stack controller drive the same project,
// with the same bundled definition and the same generated env. Two copies of
// this list is two places to forget when the overlay changes — and a stack
// status screen reporting on a *different* compose project than the wizard
// created is a bug with no visible cause.

import type { SetupConfig } from "./ports";

/** Fixed project name, so every invocation addresses the same stack. */
export const PROJECT_NAME = "ciele";

export function composeArgs(config: SetupConfig, args: readonly string[]): string[] {
  return [
    "--project-name",
    PROJECT_NAME,
    "--env-file",
    `${config.dataDir}/.env`,
    "-f",
    `${config.deployDir}/docker-compose.yml`,
    // Image mode: the app never builds from source.
    "-f",
    `${config.deployDir}/docker-compose.images.yml`,
    ...args,
  ];
}
