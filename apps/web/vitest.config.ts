import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // See packages/agent/vitest.config.ts: this suite and the agent package's
    // run concurrently under turbo, so both cap their worker pool rather than
    // sizing it to the whole machine, and both allow a contended run more than
    // vitest's 5s default.
    maxWorkers: "50%",
    testTimeout: 15_000,
  },
});
