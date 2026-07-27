import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // This package and apps/web are both ~56-file suites that turbo runs
    // concurrently, and vitest sizes its worker pool to the whole machine by
    // default — so unbounded they oversubscribe the CPU and even pure
    // string-processing tests trip the 5s default timeout. Cap the pool and give
    // the timeout headroom: these tests assert behavior, never speed.
    maxWorkers: "50%",
    testTimeout: 15_000,
  },
});
