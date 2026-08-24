import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Same treatment as packages/agent, and for the same reason: vitest sizes
    // its worker pool to the whole machine, turbo runs ~14 workspaces' tests
    // concurrently, and unbounded they oversubscribe the CPU. This suite is the
    // repo's heaviest (391 tests, and `db-contract.supabase.test.ts` alone runs
    // the whole Db contract twice, against the mock and against Supabase), so it
    // is the first to trip the 5s default timeout under load: it passes on its
    // own and failed only inside a full `turbo run test`. These tests assert
    // contract behavior, never speed.
    maxWorkers: "50%",
    testTimeout: 15_000,
  },
});
