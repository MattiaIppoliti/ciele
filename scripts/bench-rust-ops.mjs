#!/usr/bin/env node
// Latency of the operations ported to services/ciele-api, measured through
// the public /api/v1 surface, so the same run measures TypeScript or Rust
// depending only on what CIELE_RUST_OPERATIONS lists on the deployment
// (map #1111, #1122).
//
//   node scripts/bench-rust-ops.mjs run --label ts   [--base https://ciele.app] [--n 100]
//   node scripts/bench-rust-ops.mjs run --label rust
//   node scripts/bench-rust-ops.mjs compare bench-ts.json bench-rust.json
//
// A deployment URL behind Vercel Authentication needs --bypass-file, a file
// holding the project's automation bypass token.
//
// Reads only: the three list endpoints a Viewer key may call. The key is read
// from --key-file (default ~/.ciele-bench-key, one line) and never printed.
// Calls run one at a time, so each sample is one request's latency, not a
// queue's; a few warm-up calls per endpoint are discarded first.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const ENDPOINTS = [
  { name: "alerts.list", path: "/api/v1/alerts" },
  { name: "taskLabels.list", path: "/api/v1/task-labels" },
  { name: "improvements.listPage", path: "/api/v1/improvements?limit=25" },
];
const WARMUP = 5;

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean: Math.round(mean * 10) / 10,
  };
}

async function timed(url, key, bypass) {
  const started = performance.now();
  const headers = { authorization: `Bearer ${key}` };
  // A deployment URL behind Vercel Authentication: the automation bypass.
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const response = await fetch(url, { headers });
  await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status, region: response.headers.get("x-vercel-id") };
}

async function run({ base, n, label, keyFile, bypassFile }) {
  const key = readFileSync(keyFile, "utf8").trim();
  const bypass = bypassFile ? readFileSync(bypassFile, "utf8").trim() : null;
  if (!key) throw new Error(`${keyFile} is empty`);
  const results = { label, base, n, at: new Date().toISOString(), endpoints: {} };
  for (const endpoint of ENDPOINTS) {
    const url = new URL(endpoint.path, base).toString();
    for (let i = 0; i < WARMUP; i++) await timed(url, key, bypass);
    const samples = [];
    const failures = {};
    let region = null;
    for (let i = 0; i < n; i++) {
      const sample = await timed(url, key, bypass);
      region ??= sample.region;
      if (sample.status >= 200 && sample.status < 300) samples.push(Math.round(sample.ms * 10) / 10);
      else failures[sample.status] = (failures[sample.status] ?? 0) + 1;
    }
    results.endpoints[endpoint.name] = { ...summarize(samples), failures, region, samples };
    const s = results.endpoints[endpoint.name];
    console.log(
      `${endpoint.name.padEnd(24)} n=${s.n} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms mean=${s.mean}ms` +
        (Object.keys(failures).length ? ` failures=${JSON.stringify(failures)}` : "")
    );
  }
  const file = `bench-${label}.json`;
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`wrote ${file}`);
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(readFileSync(afterFile, "utf8"));
  console.log(`${"operation".padEnd(24)} ${"metric".padEnd(5)} ${before.label.padStart(9)} ${after.label.padStart(9)}   change`);
  for (const name of Object.keys(before.endpoints)) {
    const a = before.endpoints[name];
    const b = after.endpoints[name];
    if (!b) continue;
    for (const metric of ["p50", "p95", "p99", "mean"]) {
      const change = a[metric] ? ((b[metric] - a[metric]) / a[metric]) * 100 : 0;
      console.log(
        `${name.padEnd(24)} ${metric.padEnd(5)} ${String(a[metric]).padStart(7)}ms ${String(b[metric]).padStart(7)}ms   ${change > 0 ? "+" : ""}${change.toFixed(1)}%`
      );
    }
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "compare") return compare(rest[0], rest[1]);
  if (command !== "run") throw new Error("usage: bench-rust-ops.mjs run --label <name> | compare <a.json> <b.json>");
  const { values } = parseArgs({
    args: rest,
    options: {
      base: { type: "string", default: "https://ciele.app" },
      n: { type: "string", default: "100" },
      label: { type: "string" },
      "key-file": { type: "string", default: join(homedir(), ".ciele-bench-key") },
      "bypass-file": { type: "string" },
    },
  });
  if (!values.label) throw new Error("--label is required");
  await run({ base: values.base, n: Number(values.n), label: values.label, keyFile: values["key-file"], bypassFile: values["bypass-file"] });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
