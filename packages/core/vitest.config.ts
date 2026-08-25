import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The same treatment `packages/agent` and `packages/db` already carry, and
    // the third time this exact failure has been diagnosed: vitest sizes its
    // worker pool to the whole machine, turbo runs ~14 workspaces' suites
    // concurrently, and unbounded they oversubscribe the CPU.
    //
    // This package looks like the last one that would need it, since every test
    // here is a pure function over in-memory data and the whole suite spends
    // ~50s actually running assertions. That is the point: under a full
    // `turbo run test` the cost is transform and import, not the tests, and a
    // starved worker took 13s to walk a string through `parseAgenticTrace` and
    // tripped the 5s default. Nothing here asserts speed.
    maxWorkers: "50%",
    testTimeout: 15_000,
  },
});
