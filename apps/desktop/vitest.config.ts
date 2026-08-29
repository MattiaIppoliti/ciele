import { defineConfig } from "vitest/config";

// Unit tests cover the pure parts: the shared state contract and the setup
// engine. The Electron glue is covered by the E2E smoke (`pnpm test:e2e`),
// which needs a real Electron binary and so is not part of `pnpm test`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
