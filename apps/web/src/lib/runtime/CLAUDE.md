# src/lib/runtime — the chat runtime (deep module)

~100 files. Read `index.ts` and `client.ts` first — their header comments *are* the module
overview, and every export is annotated with why it is public. Only open internals when you are
changing behaviour.

## Orientation

- `turn.ts` — `streamConversationTurn`, the single entrypoint for answering a message.
- `engine.ts` — flow routing + action execution; `actions.ts` — the action handler registry.
- `agentic-search/`, `graph-search.ts`, `embeddings.ts` — retrieval.
- `ingest.ts` / `extract.ts` / `jobs.ts` — knowledge ingestion and the durable job layer.
- `tools.ts` / `catalog.ts` / `models.ts` — tool registry and the provider/model catalog.
- `egress.ts`, `trust.ts`, `redact.ts`, `pinned-fetch.ts` — the outbound-request guardrails.

## Rules

- **Adding a public capability is two edits, not one**: export it from `index.ts` (server) or
  `client.ts` (client-safe: type-only or pure static data), *and* update the expected export set
  in `interface.test.ts`. The test fails otherwise — that is the point (ADR-0005).
  - The exception, stated so nobody has to re-derive it: `interface.test.ts` locks **value**
    exports only (types erase at runtime, see its header). A type-only widening — a new
    `export type`, or a method added to an existing capability interface — needs no edit there.
    Widening the value surface always does.
- `client.ts` must stay free of the AI SDK and anything server-only; a client component importing
  it should not pull server code into the bundle.
- Inside this folder, files compose across internals freely — the import ban applies only to
  consumers outside it.
- `custom_message` (the Message action) is **verbatim**. Generative behaviour belongs in
  `search_knowledge` and the Default behavior flow only (see `agents.md`).
- Citations resolve to a Concept → Source, never an opaque chunk (ADR-0002).
- Published widget traffic runs only on Platform/API-key Provider Connections; Subscription
  connections are preview-only (ADR-0001).

## Tests

Colocated and split by concern (`ingest.crawl.test.ts`, `ingest.security.test.ts`, …). Anything
named `*.security.test.ts` asserts SSRF/egress containment — a failure there is a security
regression.

```bash
pnpm --filter @agent-hub/web exec vitest run src/lib/runtime
```

## Related docs

`docs/agentic-chat-runtime.md`, `agents.md`, ADR-0003 (two engines), ADR-0005 (deep module),
ADR-0006 (tools/sessions/skills), ADR-0017 (graph layer).
