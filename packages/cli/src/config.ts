import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where `ciele login` keeps its credential: `~/.ciele/config.json`.
 * Environment variables always win over the file (see index.ts), so CI never
 * needs the file and a paste-once laptop setup never needs the env.
 */

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ConfigStore {
  load(): CliConfig;
  save(config: CliConfig): void;
  clear(): void;
  /** Where the config lives, shown to the user by `login`/`logout`. */
  describe(): string;
}

export function fileConfigStore(
  dir = join(homedir(), ".ciele")
): ConfigStore {
  const file = join(dir, "config.json");
  return {
    load() {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as CliConfig;
      } catch {
        return {};
      }
    },
    save(config) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        // The file holds a live credential: owner read/write only (no-op on
        // Windows, where ACLs govern).
        mode: 0o600,
      });
    },
    clear() {
      rmSync(file, { force: true });
    },
    describe() {
      return file;
    },
  };
}

/** In-memory store for tests. */
export function memoryConfigStore(initial: CliConfig = {}): ConfigStore {
  let config = { ...initial };
  return {
    load: () => ({ ...config }),
    save: (next) => {
      config = { ...next };
    },
    clear: () => {
      config = {};
    },
    describe: () => "(memory)",
  };
}
