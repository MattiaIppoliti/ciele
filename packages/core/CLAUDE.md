# packages/core — `@agent-hub/core`

**The domain, and everything derivable from it.** The vocabulary `CONTEXT.md` fixes — Organization,
Assistant, Member, Knowledge Collection, Source, Concept, Publication, Flow, Provider Connection — as
types, plus the pure functions that derive facts *from* those types.

**Zero runtime dependencies. No I/O, no framework, no adapter.** That is the whole contract, and it
is what makes the vocabulary usable without dragging a Supabase client behind it (ADR-0019).

```
@agent-hub/core   ← the domain (this package)
      ▲
      ├── @agent-hub/db      declares `Db` over these types
      ├── @agent-hub/agent   runs on both
      └── apps/*
```

The arrow points one way. Nothing here may import `@agent-hub/db`, `@agent-hub/agent`, or an app.

## Commands

```bash
pnpm --filter @agent-hub/core test        # vitest run — ~2s, no pglite
pnpm --filter @agent-hub/core typecheck   # tsc --noEmit
```

## What lives here

| file | what |
|---|---|
| `types.ts` | ~150 domain types. The nouns, with no data-access concept in them. |
| `okf.ts` | Open Knowledge Format v0.2 vocabulary + the read-time derivations (`trustTier`, `conceptStatus`, `isStale`, `lastVerifiedAt`, `okfActor`). Zero imports. |
| `engine.ts` | The deterministic keyword router — the offline/no-model `matchFlow` half of the two-engine runtime (ADR-0003). Routing only. |
| `text.ts` | The shared normaliser + stopwords + stemmer both deterministic engines compare with. Moved out of `engine.ts` when a second consumer appeared — there must be exactly one normaliser. |
| `basic-interaction.ts` | Basic Interaction's deterministic tier (#566): `isCourtesyOnly` + `basicInteractionFlow`. Fails closed by design — a false positive costs a Visitor their answer, a miss costs one classify call. |
| `insights.ts` | The Insights read model as pure TS. Doubles as the **oracle** the SQL `get_insights_overview` is checked against (ADR-0010). |
| `defaults.ts` | Shipped defaults for a new Assistant and for channel availability. |
| `publication.ts` | Which Assistant fields freeze into an immutable Publication. |
| `recrawl.ts` | Per-site re-crawl cadence. Clock-free — the caller passes `now`. |
| `message.ts` · `pricing.ts` · `id.ts` | Message-part flattening, token prices, short ids. |
| `crypto.ts` · `thrown-message.ts` | Pure helpers that are not domain derivations (see below). |
| `testing/` | Fixtures, published as `@agent-hub/core/testing`. Test-only, out of the main barrel. |

## The barrel exports two ways, on purpose

- **The vocabulary** (`types.ts`, `okf.ts`) is `export *`. It has no internals to hide — its whole
  content *is* the vocabulary — so curating it would be ceremony, and `export *` keeps barrel and
  module from drifting.
- **The derivations are curated.** They *do* have internals: `computeInsightsOverview` composes seven
  helpers (`filterConversations`, `computeInsightsStats`, `computeBreakdown`, …) that are a private
  composition step, not API. Export a name when something needs it; `insights.test.ts` reaches the
  helpers directly via `./insights`.

There is deliberately no `interface.test.ts` — unlike `@agent-hub/agent`, this package has no deep
implementation behind a narrow surface to protect. If the curated half starts growing without
consumers, that is the signal to add one.

## Adding to this package

- **A domain type**: add the term to `CONTEXT.md` first, then the type here. Keep the name the one
  `CONTEXT.md` fixes.
- **A derivation**: it belongs here if it is a pure function of domain types. If it needs a `Db`, it
  belongs in `@agent-hub/db` (see `improvements.ts` there — it takes `Db`, so it stayed).
- **A pure helper that is not domain logic** (`crypto.ts`, `thrown-message.ts`): the bar is *two or
  more workspaces need it, and it is pure*. These predate the domain move; keep that section small
  rather than letting it become a junk drawer.
- **Anything with a dependency**: it belongs in the package that already owns that dependency.

## Related

`CONTEXT.md` (the vocabulary this package encodes) · ADR-0019 (why the domain is not in `db`) ·
ADR-0002 (OKF) · ADR-0003 (two engines) · ADR-0010 (the Insights oracle) ·
[`packages/db/CLAUDE.md`](../db/CLAUDE.md)
