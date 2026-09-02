// One command that reproduces the admin latency numbers locally.
//
// Builds apps/web in mock mode (no Supabase env, so the app serves the demo
// Organization with no sign-in), starts `next start` on a free port, and runs
// the two manual probes against it with 20 samples each:
//
//   check-admin-latency.mjs       document response times, plus the cold
//                                 Insights read after expiring its cache
//   check-admin-interactions.mjs  sidebar click-to-visible and the profile
//                                 Server Action, in a real Chromium
//
// Deliberately NOT part of `pnpm verify`: it needs a browser and a production
// build, and a mock database measures the app, not the deployment. The
// numbers it prints are a regression baseline; staging, with real RLS and
// data volume, stays the authority (docs/runbooks/admin-performance.md).
//
//   pnpm --filter @agent-hub/web exec playwright-core install chromium   # once
//   pnpm --filter @agent-hub/web check:admin-perf
//   ADMIN_PERF_SKIP_BUILD=1 pnpm --filter @agent-hub/web check:admin-perf  # reuse .next

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = process.env.ADMIN_PERF_SAMPLES ?? "20";

// Mock mode is decided at build time: Next inlines NEXT_PUBLIC_* into the
// bundle, so the build and the server must agree on an empty Supabase URL.
const mockEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: web, env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with ${child.exitCode} before serving`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${baseUrl} did not answer within 60s`);
}

if (process.env.ADMIN_PERF_SKIP_BUILD !== "1") {
  run("pnpm", ["exec", "next", "build"], mockEnv);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
  cwd: web,
  env: mockEnv,
  stdio: ["ignore", "inherit", "inherit"],
});

let failed = false;
try {
  await waitForServer(baseUrl, server);
  const probeEnv = {
    ...mockEnv,
    ADMIN_PERF_BASE_URL: baseUrl,
    ADMIN_PERF_SAMPLES: samples,
  };
  delete probeEnv.ADMIN_PERF_COOKIE;
  for (const script of ["check-admin-latency.mjs", "check-admin-interactions.mjs"]) {
    console.log(`\n== ${script} against ${baseUrl} (mock mode, ${samples} samples) ==`);
    const result = spawnSync(process.execPath, [join(web, "scripts", script)], {
      cwd: web,
      env: probeEnv,
      stdio: "inherit",
    });
    failed ||= result.status !== 0;
  }
} finally {
  server.kill("SIGTERM");
}

if (failed) process.exitCode = 1;
