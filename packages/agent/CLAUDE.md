# packages/agent, `@agent-hub/agent`

The chat runtime, as a deep module with a real package boundary (ADR-0005, as amended by
ADR-0018). ~110 files.
Read `src/index.ts`, `src/client.ts` and `src/local-providers.ts` first, their header comments
*are* the module overview, and every export is annotated with why it is public. Only open internals
when you are changing behaviour.

**Framework-free by contract.** Nothing here imports `next/*`. The facts the runtime needs from
its host are ports in `src/host.ts`, registered once at startup (apps/web does it from
`src/instrumentation.ts`) and all defaulted so the runtime stays correct unwired:

- `getPlatformSystemPrompt()`, default: the shipped `DEFAULT_PLATFORM_PROMPT`. apps/web registers a
  tagged, cached, service-role read of the owner's stored override.
- `scheduleAfterResponse(work)`, default: **drop it**. Every caller has already written a durable
  job-ledger row and cron drains it, so an unregistered host costs first-response latency, never
  work. apps/web registers Next's `after()`.
- `allowRelaxedEgress()`, default: **false** (strict: no plain HTTP, no loopback for
  tenant-configured outbound requests). apps/web relaxes it for `next dev` and for Vercel
  preview/development only. It is tested **positively**: `VERCEL_ENV` is unset everywhere that is
  not Vercel, so the old `VERCEL_ENV !== "production"` read an absent variable as a dev signal and
  relaxed the policy on every self-host, Docker and Desktop install.

## Commands

```bash
pnpm --filter @agent-hub/agent test        # vitest run
pnpm --filter @agent-hub/agent typecheck   # tsc --noEmit
```

Single test file: `pnpm --filter @agent-hub/agent exec vitest run src/engine.test.ts`.

## Orientation

- `turn.ts`: `streamConversationTurn`, the single entrypoint for answering a message.
- `engine.ts`: flow routing + action execution; `actions.ts`, the action handler registry.
- `agentic-search/`, `graph-search.ts`, `embeddings.ts`, retrieval.
- `ingest.ts` / `extract.ts` / `jobs.ts`, knowledge ingestion and the durable job layer.
- `scheduled.ts`: one function per cron tick (`sweepDueRecrawls`, `finalizeDueCrawls`); the cron
  endpoints in apps/web are auth-and-serialize adapters over these.
- `tools.ts` / `catalog.ts` / `models.ts`, tool registry and the provider/model catalog.
- `render-tools.ts`, the render catalogue: tools whose whole effect is the **Reply Component** they
  show the Visitor. `instrument` dispatches on the spec shape, so a render tool gets the same
  lifecycle, panel row and Simplified-thinking narration as any other, and their arguments stream to
  the client as `tool-input-delta` so the component materializes.
  `reply-components.ts` (client-safe) is the **one** normalizer, the caps and the squaring rule that
  the zod schema, the part builder, the Inbox export and the live client's provisional render all
  share; three copies of that rule had already diverged once. `partial-json.ts` (client-safe, zero
  imports) parses the streamed accumulation into props; `component-text.ts` flattens a component
  back to text for the Inbox export.
- `local-subscriptions.ts` / `local-subscription-model.ts`, provider CLIs as an inference backend
  (ADR-0015), published through the `./local-providers` barrel.
- `egress.ts`, `trust.ts`, `redact.ts`, `pinned-fetch.ts`, the outbound-request guardrails.
- `host.ts`: the host ports above. `ee.ts`, the enterprise capability registry.

## Rules

- **Adding a public capability is two edits, not one**: export it from the right barrel, `index.ts`
  (server), `client.ts` (client-safe: type-only or pure static data), `local-providers.ts` (provider
  CLIs), *and* update the expected export set in `interface.test.ts`. The test fails otherwise,
  that is the point (ADR-0005).
  - The exception, stated so nobody has to re-derive it: `interface.test.ts` locks **value**
    exports only (types erase at runtime, see its header). A type-only widening, a new
    `export type`, or a method added to an existing capability interface, needs no edit there.
    Widening the value surface always does.
- **Do not import `next/*` or anything from `apps/web`.** If the runtime needs a fact only the host
  knows, add a port to `host.ts` with a default that keeps the runtime correct.
- **Domain types come from `@agent-hub/core`, data-access operations from `@agent-hub/db`**
  (ADR-0019). Pure domain logic, flow routing, OKF derivations, the Insights oracle, belongs in
  `core`, not here: this package is the *runtime*, not the vocabulary.
- `client.ts` must stay free of the AI SDK and anything server-only; a client component importing it
  should not pull server code into the bundle.
- Inside `src/`, files compose across internals freely, the boundary applies to consumers, and it is
  enforced by the `exports` map (a deep import does not resolve), not by a lint rule.
- `custom_message` (the Message action) is **verbatim**. Generative behaviour belongs in
  `search_knowledge`, the Default behavior flow, and `basic_reply`, and nowhere else (see
  `agents.md`). `basic_reply` is the deliberate third: it generates, but it is the *only* generative
  action that never retrieves, so it must never assert a fact about the organization. A new action
  that wants to generate needs an argument for why it is not one of these three.
- Citations resolve to a Concept → Source, never an opaque chunk (ADR-0002).
- Published widget traffic runs only on Platform/API-key Provider Connections; Subscription
  connections are preview-only (ADR-0001).

## Tests

Colocated and split by concern (`ingest.crawl.test.ts`, `ingest.security.test.ts`, …). Anything named
`*.security.test.ts` asserts SSRF/egress containment, a failure there is a security regression.

`vitest.config.ts` caps `maxWorkers` and raises `testTimeout`: this suite and apps/web's are both
~56 files and turbo runs them concurrently, so an unbounded pool oversubscribes the CPU and trips
the default timeout on tests that assert behaviour, not speed.

```bash
pnpm --filter @agent-hub/agent test
```

## Related docs

`docs/agentic-chat-runtime.md`, `agents.md`, ADR-0003 (two engines), ADR-0005 (deep module +
package boundary), ADR-0006 (tools/sessions/skills), ADR-0015 (local CLI connections),
ADR-0017 (graph layer).
