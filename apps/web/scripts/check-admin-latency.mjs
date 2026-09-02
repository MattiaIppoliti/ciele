// Document-response budgets for the latency-sensitive admin routes. Manual,
// not part of `pnpm verify`: CI has no representative network, dataset or
// Member session. `check:admin-perf` runs it against a local mock-mode build
// (no cookie needed, the demo session is implicit); against staging pass the
// Member's cookie:
//
// ADMIN_PERF_BASE_URL=https://staging.example.com \
// ADMIN_PERF_COOKIE='sb-...=...' \
// pnpm --filter @agent-hub/web check:admin-latency

const baseUrl = process.env.ADMIN_PERF_BASE_URL;
const cookie = process.env.ADMIN_PERF_COOKIE;
const sampleCount = Number(process.env.ADMIN_PERF_SAMPLES ?? 20);

if (!baseUrl) {
  throw new Error("ADMIN_PERF_BASE_URL is required");
}
if (!Number.isSafeInteger(sampleCount) || sampleCount < 5 || sampleCount > 100) {
  throw new Error("ADMIN_PERF_SAMPLES must be an integer from 5 to 100");
}

const routes = [
  { path: "/", coldMs: 1000, p50Ms: 150, p95Ms: 300 },
  { path: "/inbox", coldMs: 1000, p50Ms: 150, p95Ms: 300 },
  { path: "/improvements", coldMs: 1000, p50Ms: 150, p95Ms: 300 },
  { path: "/insights", coldMs: 1000, p50Ms: 150, p95Ms: 300 },
];

function percentile(values, rank) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil((rank / 100) * ordered.length) - 1)];
}

async function measure(path) {
  const started = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      Accept: "text/html",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "manual",
  });
  await response.arrayBuffer();
  const elapsed = performance.now() - started;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return elapsed;
}

async function expireInsightsCache() {
  const response = await fetch(new URL("/api/insights", baseUrl), {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  if (response.status !== 204) {
    throw new Error(`/api/insights cache reset returned HTTP ${response.status}`);
  }
}

let failed = false;
for (const route of routes) {
  if (route.path === "/insights") await expireInsightsCache();
  const cold = await measure(route.path);
  const warm = [];
  for (let index = 0; index < sampleCount; index += 1) {
    warm.push(await measure(route.path));
  }
  const p50 = percentile(warm, 50);
  const p95 = percentile(warm, 95);
  const passes =
    cold <= route.coldMs && p50 <= route.p50Ms && p95 <= route.p95Ms;
  failed ||= !passes;
  console.log(
    `${passes ? "PASS" : "FAIL"} ${route.path} ` +
      `cold=${cold.toFixed(0)}ms/${route.coldMs}ms ` +
      `p50=${p50.toFixed(0)}ms/${route.p50Ms}ms ` +
      `p95=${p95.toFixed(0)}ms/${route.p95Ms}ms (${sampleCount} warm samples)`,
  );
}

if (failed) process.exitCode = 1;
