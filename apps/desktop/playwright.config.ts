import { defineConfig } from "@playwright/test";

// One smoke, run serially against a real Electron process. Breadth lives in
// the setup engine's unit tests; what only this can prove is that the app
// launches, the two paths are reachable, and the wizard's failure and retry
// look the way a user would need them to.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Electron start-up plus the fake ports' deliberate latency.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? "list" : "line",
  forbidOnly: !!process.env.CI,
  retries: 0,
});
