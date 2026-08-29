import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Same bound as every other workspace: turbo runs ~14 suites concurrently
    // and an unbounded vitest worker pool sizes itself to the whole machine.
    maxWorkers: "50%",
    testTimeout: 15_000,
  },
});
