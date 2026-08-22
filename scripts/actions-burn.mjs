#!/usr/bin/env node
// What GitHub Actions is costing this repo, and which workflow is spending it.
//
// Why this exists: August 2026 ran out of Actions minutes on the 19th, and
// every job after that was refused before it started with "recent account
// payments have failed or your spending limit needs to be increased", which
// reads like a payment problem and is really a quota problem. Nothing warned.
//
// Why it is a script and not a workflow: the thing being measured is minutes,
// so the measurement should not cost any. Run it from a laptop or an agent
// session; it needs `gh auth` and read access, nothing else.
//
// Two things the Actions UI will not tell you and this will:
//   - the /timing endpoint reports billable.total_ms as 0 for this repo, so
//     minutes are recomputed from each job's started_at/completed_at, rounded
//     UP per job the way GitHub bills them;
//   - a macOS minute costs ten Linux minutes and a Windows minute two, so the
//     workflow with the most wall-clock time is usually not the costly one.
//
//   node scripts/actions-burn.mjs [--month YYYY-MM] [--repo owner/name] [--plan Pro]
//
// Defaults to the checkout's own `origin` and the current month.

import { execFileSync } from "node:child_process";

// https://docs.github.com/billing/managing-billing-for-github-actions
const MULTIPLIER = { UBUNTU: 1, WINDOWS: 2, MACOS: 10 };
// Included private-repo minutes per month, by plan.
const ALLOWANCE = { Free: 2000, Pro: 3000, Team: 3000, Enterprise: 50000 };

/** Which runner OS a job ran on, read off its labels. */
export function runnerOs(labels) {
  const joined = (labels ?? []).join(",").toLowerCase();
  if (joined.includes("macos")) return "MACOS";
  if (joined.includes("windows")) return "WINDOWS";
  return "UBUNTU";
}

/** Billable minutes for one job: whole minutes rounded up, times the OS rate. */
export function billableMinutes(job) {
  if (!job?.started_at || !job?.completed_at || job.conclusion === "skipped") return 0;
  const seconds = (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000;
  if (!(seconds > 1)) return 0;
  return Math.ceil(seconds / 60) * MULTIPLIER[runnerOs(job.labels)];
}

/** Last day of `YYYY-MM`, as `YYYY-MM-DD`. */
export function lastDayOfMonth(ym) {
  const [year, month] = ym.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/**
 * The repo to read, from `--repo` or the checkout's own origin.
 *
 * Deliberately not defaulted to a literal: the private tracker's slug is a
 * mirror-gate deny token (scripts/ ships to the public tree), and a script that
 * reads its own remote works in a fork without an edit anyway.
 */
function currentRepo() {
  const explicit = flag("repo", null);
  if (explicit) return explicit;
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`cannot read owner/name out of the origin remote: ${url}`);
  return m[1];
}

function api(path) {
  return JSON.parse(
    execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    }),
  );
}

function main() {
  const repo = currentRepo();
  const month = flag("month", new Date().toISOString().slice(0, 7));
  const plan = flag("plan", "Pro");
  const allowance = ALLOWANCE[plan] ?? ALLOWANCE.Pro;
  const range = `${month}-01..${lastDayOfMonth(month)}`;

  process.stderr.write(`Reading ${repo} runs for ${month}\n`);
  const runs = [];
  for (let page = 1; page <= 12; page++) {
    const batch =
      api(`/repos/${repo}/actions/runs?per_page=100&page=${page}&created=${range}`)
        .workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < 100) break;
  }

  const byWorkflow = new Map();
  const byDay = new Map();
  let billed = 0;
  let wall = 0;

  runs.forEach((run, i) => {
    if (i % 25 === 0) process.stderr.write(`  ${i}/${runs.length}\r`);
    let jobs;
    try {
      jobs = api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).jobs ?? [];
    } catch {
      return; // a run whose jobs have been pruned tells us nothing
    }

    const name = run.path.replace(".github/workflows/", "");
    const entry = byWorkflow.get(name) ?? { runs: 0, billed: 0, wall: 0, os: {} };
    entry.runs++;

    let runBilled = 0;
    for (const job of jobs) {
      const cost = billableMinutes(job);
      if (!cost) continue;
      const os = runnerOs(job.labels);
      const minutes = cost / MULTIPLIER[os];
      entry.billed += cost;
      entry.wall += minutes;
      entry.os[os] = (entry.os[os] ?? 0) + minutes;
      runBilled += cost;
      billed += cost;
      wall += minutes;
    }
    byWorkflow.set(name, entry);

    const day = run.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + runBilled);
  });
  process.stderr.write("                         \r");

  const share = ((100 * billed) / allowance).toFixed(0);
  console.log(`\nGitHub Actions · ${repo} · ${month}`);
  console.log(`  runs               : ${runs.length}`);
  console.log(`  wall-clock minutes : ${wall}`);
  console.log(`  BILLABLE minutes   : ${billed}   (${share}% of the ${allowance} included on ${plan})`);
  if (billed > allowance) {
    console.log(
      `  OVER by ${billed - allowance}. Past the allowance, jobs are refused outright while the spending limit is $0.`,
    );
  }

  console.log(`\n  ${"workflow".padEnd(24)}${"runs".padEnd(6)}${"wall".padEnd(7)}${"billable".padEnd(10)}share`);
  for (const [name, e] of [...byWorkflow].sort((a, b) => b[1].billed - a[1].billed)) {
    if (!e.billed) continue;
    const premium = Object.entries(e.os)
      .filter(([os]) => os !== "UBUNTU")
      .map(([os, m]) => `${m}m ${os} x${MULTIPLIER[os]}`)
      .join(", ");
    console.log(
      `  ${name.padEnd(24)}${String(e.runs).padEnd(6)}${String(e.wall).padEnd(7)}` +
        `${String(e.billed).padEnd(10)}${((100 * e.billed) / billed).toFixed(0)}%` +
        (premium ? `   <- ${premium}` : ""),
    );
  }

  console.log("\n  cumulative by day (billable)");
  let cumulative = 0;
  for (const [day, minutes] of [...byDay].sort()) {
    cumulative += minutes;
    console.log(
      `  ${day}  +${String(minutes).padStart(4)}  = ${String(cumulative).padStart(5)}` +
        (cumulative > allowance ? "   OVER" : ""),
    );
  }
}

if (process.argv[1]?.endsWith("actions-burn.mjs")) main();
