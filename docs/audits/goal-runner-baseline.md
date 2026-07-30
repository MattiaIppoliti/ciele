# Goal-runner baseline — the ReadyToAnswer loop

The eval gate #558 promised ("goal-runner evals show no regression against the
flag-off baseline") could not run as written: the loop shipped as one path, so
there is no flag-off setting to compare against. This file is the honest
version of that gate — the recorded baseline the **next** loop change is
compared against, plus how to reproduce it.

## Baseline (2026-07-30, commit `be5220c5`)

| Suite | Command | Result |
|---|---|---|
| Goal-runner fixtures | `pnpm --filter @agent-hub/agent exec vitest run src/goal-runner.test.ts src/goals.test.ts` | 2 files, **11/11 passed** |
| Full runtime suite (loop, agentic search, terminal tool, budget, narration) | `pnpm --filter @agent-hub/agent test` | 61 files, **813/813 passed** |

No failures to triage; nothing filed.

## What this baseline covers — and what it does not

- The fixtures run **offline** through the mock `Db`: with no provider
  connections the engine takes the deterministic keyword path, so a
  `custom_message` flow yields a real, gradable answer with no model. They pin
  the runner's *orchestration* (publication gating, alert raising, cadence
  lease, quarantine) and the loop's *rules* (terminal declaration mandatory,
  budget notes, anti-re-clarify coercion — see `actions.test.ts` and
  `agentic-search/*.test.ts`).
- They do **not** measure live answer quality. That runs continuously in
  production instead: `/api/cron/verify-goals` re-verifies every Standing Goal
  against the latest Publication daily, and a regression there raises an
  auto-resolving Alert per goal. Treat the Standing Goals dashboard as the
  live half of this gate.

## Fixtures and the deleted scaffolding

#558 deleted the deterministic retrieval scaffolding (`decideClarify`,
`nextReformulation`, `rephraseQuery`, `understandQuery`,
`describeSearchIntent`) together with the tests that asserted its mechanism.
The suites that remain assert **outcomes**: exactly one clarification per
conversation, an honest dead-end message, one `ReadyToAnswer` call per turn.
`scoreCoverage` survives deliberately in its *recorder* role only — it stamps
the per-pass coverage verdict on the transcript and decides nothing.

## How to update this baseline

After any deliberate loop change: run both commands above, triage every
failure into a fix or a filed issue, then update the table (date, commit,
counts) in the same PR as the change.
