# apps/docs — `@agent-hub/docs`

Public documentation site, built on Fumadocs (`fumadocs-core` / `fumadocs-mdx` / `fumadocs-ui`).

## Commands

```bash
pnpm --filter @agent-hub/docs typecheck   # tsc --noEmit
pnpm --filter @agent-hub/docs lint        # eslint
pnpm --filter @agent-hub/docs test        # node --test over scripts/ (the MDX block parser)
```

Dev server: Browser pane, config `docs` (port 3200).

## Conventions

- Content is MDX under the Fumadocs source directory; the route tree is derived from it — adding
  a page means adding a file plus its `meta.json` entry, not a React route.
- **Only ever write English.** `page.mdx` is the source of truth; `page.it.mdx`, `.es`, `.fr`, `.de`
  and every `meta.<lang>.json` are **generated** by `scripts/translate-docs.mjs` (Lara Translate) and
  committed. After editing or adding an English page, regenerate with
  `LARA_ACCESS_KEY_ID=… LARA_ACCESS_KEY_SECRET=… pnpm --filter @agent-hub/docs translate:docs`; the
  run is incremental (`scripts/.translation-cache.json` keyed by source hash), so it only touches
  what changed. `--ui` also regenerates `src/lib/ui-strings.ts`. Credentials come from the
  environment and are never stored in the repo.
- The parser that protects code fences, JSX, diagrams, interface labels and YAML scalars is
  `scripts/mdx-blocks.mjs`, covered by `scripts/mdx-blocks.test.mjs` — including a round-trip over
  the whole English corpus. Touch the parser, run the test.
- Locale routing: `src/lib/i18n.ts` is the config **and nothing else** (the edge middleware imports
  it); the translated UI chrome lives in `src/lib/i18n-ui.ts`, which only the root layout imports.
  English keeps the bare paths (`hideLocale: 'default-locale'`); `/llms.txt`, `/llms-full.txt` and
  the `.md` endpoints stay English-only and are excluded from the middleware matcher.
- `postinstall` runs `fumadocs-mdx` to regenerate the source map. After adding or renaming
  content files, re-run `pnpm install --filter @agent-hub/docs` (or the `fumadocs-mdx` binary) if
  the new page 404s.
- Shared primitives come from `@agent-hub/ui`; don't fork them here. `global.css` must keep its
  `@source "../../../../packages/ui/src"` line — Tailwind v4 only scans this app's own tree, so
  without it any utility used *only* inside the shared package is never generated and the component
  renders unstyled (this silently broke `CopyFeedbackIcon`: its grid overlay collapsed and the check
  mark wrapped onto its own line).
- This is end-user product documentation. Internal engineering docs belong in `/docs`, and
  agent-facing guidance belongs in a `CLAUDE.md`. **One carve-out**:
  `content/docs/self-hosting/architecture/` is contributor-facing architecture documentation —
  self-hosters and OSS contributors need it, and it ships in the public mirror. It is the reader-
  facing counterpart to [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and to the
  `/visualize-repo` layer in `.agent-native/visual-docs/repo-overview/plan.mdx`; a change to one
  of the three should update the others. Keep it describing an **OSS checkout** — never enumerate
  the enterprise internals under `ee/`, which the mirror strips.
- **Diagrams** use `<Mermaid chart={...} title="..." />` (`src/components/mermaid.tsx`), registered
  globally in `src/components/mdx.tsx` alongside `Files`/`Folder`/`File` — no per-page import.
  `mermaid` is a dynamic `import()`, so only pages with a diagram pay for it. The component renders
  hand-drawn (`look: 'handDrawn'`, Excalidraw-style) with a deterministic seed hashed from the chart
  source, letters it in the `--font-sketch` handwriting face (`Architects_Daughter`, declared in
  `app/layout.tsx`), pulls its palette from the live `--color-fd-*` tokens so both themes come from
  one source of truth, and puts a "Mermaid" copy-source button in each figure's top-right corner.
  Authoring constraints:
  - **Width.** Diagrams render at natural size and scroll inside their figure if wider — the figure
    itself never exceeds the prose column (~800px at 1440px viewport). Prefer `flowchart TB`, short
    labels, and **≤3 nodes per rank**. A 4-node rank almost always overflows: pull the first node out
    of the subgraph instead. An LR chain of 5+ ranks overflows too — use TB. `erDiagram` fans out
    very wide; a flowchart with `-->|"has many"|` labels is usually narrower. The hand-drawn look
    adds ~15px, so leave headroom.
  - **No hardcoded colors** (`classDef fill:`, `rect rgb(...)`) — the component re-renders on theme
    change and literal colors break one of the two themes.
  - `direction` **inside a subgraph is ignored** once an edge crosses that subgraph's boundary;
    without it the parent `TB` ranks unconnected siblings side by side, which is usually what you
    want anyway.
  - **Keep it linear.** Prefer a single spine with short branches over a mesh. Never point an edge at
    a `subgraph` id — mermaid draws it from the group's border, so it reads as an arrow starting from
    nowhere; target the nodes instead. Use a subgraph only when the box genuinely *labels* parallel
    paths (the read-vs-write diagram in `request-flows.mdx` earns one; a layered stack does not).
    A cross-link between two otherwise independent chains will distort the whole layout — state the
    relationship in prose instead.
  - **`sequenceDiagram` does not get the hand-drawn look** — mermaid 11 only applies `look` to
    diagrams on its unified renderer (flowchart, class, state). Sequence diagrams also run wide with
    5+ participants. Use one only when the ordering genuinely is the point.
