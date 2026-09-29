import type { CliConfig, ConfigStore } from "./config.ts";

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
