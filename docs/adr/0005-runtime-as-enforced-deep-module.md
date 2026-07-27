# The chat runtime is an enforced deep module (barrel + lint boundary, not a package)

## Status

**Partially superseded by [ADR-0018](0018-agent-runtime-as-a-package.md).** The substance below
stands — the runtime is a deep, gray-box module with narrow curated barrels locked by
`interface.test.ts`. What ADR-0018 replaces is the *enforcement mechanism* and the location: the
runtime is now the `@agent-hub/agent` package, its `exports` map makes deep imports unresolvable, and
the ESLint rule described here is deleted. Read the "Rejected — extract to `packages/runtime`"
section below as history: both of its cost premises were measured and found wrong, and its flip
condition (external reuse) was the wrong trigger.

`apps/web/src/lib/runtime/` had grown to ~25 files that any code in the app could import
individually — no declared interface, so a fresh reader (human or agent) saw a pile of disparate
files instead of one seam. Meanwhile `crypto` (secret sealing) and `notify` (improvement-email
templates) squatted inside the folder despite not being the chat runtime, and client components
reached straight into `runtime/stream` and `runtime/catalog`.

**Decision.** Treat the runtime as a **deep, gray-box module** with a narrow, curated public
interface and enforce that interface with lint rather than a package boundary:

- Two entry points — **`@/lib/runtime`** (server) and **`@/lib/runtime/client`** (client-safe,
  type-only + static data). Everything else in the folder is internal.
- An ESLint `no-restricted-imports` rule (`apps/web/eslint.config.mjs`) makes importing
  `@/lib/runtime/<internal>` from outside the folder an **error**; only the two barrels are allowed.
  Files inside `src/lib/runtime/**` are exempt so they compose freely.
- The export shape of both barrels is locked by `interface.test.ts`, so re-widening the interface is
  a deliberate, reviewed act.
- Evicted `crypto` → `lib/crypto.ts` and `notify` → `lib/notify.ts`: `crypto` is a security
  primitive used by both runtime (`models.ts`) and non-runtime (`actions.ts`), so it belongs at the
  common `lib/` level; `notify` is improvement-domain, not chat. `email` and `models` stay — the
  chat path legitimately uses them.

**Rationale.**
- **Navigability for a memoryless reader.** The interface sits at the top: read `index.ts` /
  `client.ts` to know what the runtime *does*, open internals only to change behavior. This is the
  whole point — an agent orients from one file, not 25.
- **The two-entry split is forced, not stylistic.** The server surface pulls in the AI SDK + Node
  crypto; the client surface is type-only + static. A single barrel imported from a client component
  would drag server-only code into the browser bundle.
- **Enforcement over convention.** The seam existed only in humans' heads and the docs; nothing
  stopped a casual deep import. The lint rule is the compiler-adjacent guardrail that keeps the map
  true as the codebase changes under many hands (and many agents).

**Rejected — extract to `packages/runtime` (a real package like `@agent-hub/db`).** The purest
boundary (package `exports` physically hide internals), but higher churn and harder to reverse: it
means inverting the one outward coupling (`turn.ts` → `@/lib/platform`), dropping the `@/` alias
inside the package, and wiring Turbo/tsconfig references — for a module only ever consumed by
`apps/web`. The lint boundary gets ~95% of the benefit at a fraction of the cost. **Flip condition:**
promote to a package if the runtime ever needs to be reused outside `apps/web` (e.g. `apps/admin` or
a standalone ingestion worker).

**Consequences.** New public runtime capability = add it to the right barrel *and* update
`interface.test.ts` on purpose. The boundary is one repo's lint config, not a physical package, so a
determined author can still disable the rule — acceptable, because the goal is to make the right
thing the easy default and the wrong thing loud, not to make leaks impossible.
