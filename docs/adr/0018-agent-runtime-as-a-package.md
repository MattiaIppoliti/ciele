# The chat runtime is a package (`@agent-hub/agent`), not a folder behind a lint rule

## Status

Accepted. **Supersedes the enforcement mechanism of [ADR-0005](0005-runtime-as-enforced-deep-module.md)**
and its "rejected — extract to a package" section. ADR-0005's substance stands: the runtime is a
deep, gray-box module with narrow curated barrels whose shape is locked by `interface.test.ts`. What
changes is *what enforces the seam* and *where the code lives*.

## Context

ADR-0005 chose a lint rule over a package and recorded a flip condition: promote to a package "if
the runtime ever needs to be reused outside `apps/web`". That condition has **not** occurred — the
runtime still has exactly one consumer. We are flipping anyway, because the two premises the
rejection rested on both turned out to be wrong when measured.

**Premise 1: "the lint boundary gets ~95% of the benefit."** It did not. The rule's pattern was
`group: ["@/lib/runtime/*", "!@/lib/runtime/client"]`, and that glob is single-segment: it never
matched `@/lib/runtime/agentic-search/<file>`. An entire subdirectory of the module — the Agentic
Search implementation — was importable from anywhere in the app with no error. Nothing had exploited
the hole, but "enforcement over convention" was the ADR's own stated rationale, and the enforcement
had a hole in it that a reader could not see.

**Premise 2: extraction means "inverting the one outward coupling, dropping the `@/` alias, and
wiring Turbo/tsconfig — higher churn and harder to reverse."** Measured, the outward coupling was
**three imports in three files**:

- `jobs.ts` → `after` from `next/server`, at 3 call sites.
- `turn.ts` and `goal-runner.ts` → `getPlatformSystemPrompt` from `@/lib/platform`.

Both were already shaped like injectable ports, and no file in the folder imported `@/app/**`,
`@/components/**`, or carried a `"use server"` directive. The layering was already right; only the
manifest was missing.

## Decision

Move `apps/web/src/lib/runtime/` to **`packages/agent`** (`@agent-hub/agent`) and let module
resolution enforce the seam.

1. **Three entry points, declared in `exports`**: `.` (server), `./client` (client-safe: type-only +
   static data), `./local-providers` (the provider-CLI surface of ADR-0015, which has its own
   consumers — Settings, the connect flow, the relay routes — and would otherwise have widened the
   server barrel by 13 exports). Nothing else is declared, so a deep import into internals **does not
   resolve**, in `tsc` or the bundler. The ESLint rule is deleted, hole included.
2. **The package is framework-free.** Nothing under `packages/agent/src` imports `next/*`. The two
   facts the runtime needs from its host are ports in `host.ts`, registered once at startup by
   `apps/web/src/instrumentation.ts`. Both have defaults, but they are **not equally strong**, and the
   asymmetry is the interesting part of this decision:
   - `scheduleAfterResponse(work)` defaults to **dropping the work**, and that is *fail-safe by
     construction*: every caller writes a durable job-ledger row first and cron drains it (ADR-0008),
     so an unregistered host costs first-response latency and nothing else. `apps/web` registers
     Next's `after()`, which must await a returned promise — the port's one contractual obligation.
   - `getPlatformSystemPrompt()` defaults to the shipped `DEFAULT_PLATFORM_PROMPT` (which moves into
     the package, because the runtime must have a usable prompt with no host present). This default is
     only **fail-soft**: an unregistered host keeps answering, but silently stops honouring the
     platform owner's stored override. The runtime cannot detect that, and the direct import it
     replaces could not be forgotten — so the registration itself is now covered by
     `apps/web/src/instrumentation.test.ts`. **Converting an import into a port converts a compile
     error into a wiring obligation; the obligation needs its own test.**
3. **`@agent-hub/core`** is created for pure helpers neither the app nor the runtime owns: `crypto.ts`
   (three unrelated consumers seal secrets — provider connections, SSO, and credential resolution
   inside the runtime) and `thrown-message.ts`. Zero runtime dependencies, by contract. ADR-0005
   evicted `crypto` to "the common `lib/` level"; with the runtime in a package, the common level is a
   package.
4. **The cron tick's policy moves into the runtime.** `scheduled.ts` owns `sweepDueRecrawls` and
   `finalizeDueCrawls` — batch sizes, the lease window, per-Source failure reporting, and the report
   payload. The two cron endpoints become auth-and-serialize adapters (61→23 and 84→24 lines).

   To be precise about why: the routes themselves only needed a changed import path, so this was *not*
   strictly forced. What was forced is a choice between two options, because
   `recrawl.scheduled.test.ts` — the end-to-end provider-seam test — imports the two route handlers
   *and* mocks runtime internals (`./apify`, `./crawl4ai`, `./local-crawl`) to fake the network edge.
   No package boundary can be spanned that way. Either that test loses its route-level coverage, or
   the policy moves to the side the test lives on. We moved the policy, because a batch size and a
   lease window are runtime behaviour that had been sitting in a Next route handler. The route tests
   keep the auth cases and become pass-through assertions; the behavioural cases they held move to
   `scheduled.test.ts`.

## Consequences

- Adding a public capability is still two edits: the right barrel **and** `interface.test.ts`, which
  now locks three barrels.
- A leak is no longer merely loud, it is **unrepresentable**: `apps/web` cannot import a runtime
  internal, and `packages/agent` cannot import from `apps/web` at all. The framework-free property is
  enforced by the package simply not depending on `next`.
- The runtime's ~12,500 lines of tests run without Next present, and turbo caches them as their own
  task. That also doubled the number of large concurrent vitest suites, which required bounding the
  worker pools — see `packages/agent/vitest.config.ts`.
- ADR-0005's flip condition was the wrong trigger. The binding constraints were enforcement quality
  and test isolation, not reuse. **A flip condition should name the property that would change the
  decision, not a hypothetical future consumer.**
