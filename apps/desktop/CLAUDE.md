# apps/desktop — agent notes

Read [`README.md`](README.md) first: commands, layout, and the reasoning behind
the seams. This file is only the things that bite.

- **Three processes, two tsconfigs.** `tsconfig.node.json` covers main, preload,
  shared, setup and the tooling; `tsconfig.web.json` covers the renderer plus
  the two `src/setup` files it needs (`types.ts`, `ports.ts`) and nothing else —
  the rest of `src/setup` reaches for `node:crypto` in its *test* fakes, which
  the DOM config cannot see. `pnpm typecheck` runs both. The root `tsconfig.json`
  is a reference stub; editor diagnostics from it are meaningless.
- **`src/setup/` must not import `electron`, `node:*` or React.** That is the
  whole reason the wizard is testable. The one exception is
  `src/setup/testing/fake-ports.ts`, which is a fake and uses `node:crypto` on
  purpose — a fake HMAC would make the signature tests agree with themselves.
- **Adding a wizard step** means adding it to `SETUP_STEPS` and to the ordering
  assertion in `steps.test.ts`, which pins the list on purpose.
- **`src/shared/` is imported by all three processes**, so anything added there
  must be free of `electron` and node builtins too.
- **The preload has no generic `invoke`.** Every method is a named channel; a
  passthrough would make the bridge surface unbounded. Adding a capability means
  adding it to the bridge interface in `shared/`, the preload, and the main
  handler — three places, deliberately.
- **The product window gets no preload.** Do not attach one "just for the mode
  switch"; the app menu is how you reach native surface from the product.
- `pnpm test` is vitest only. The Playwright smoke is `pnpm test:e2e` and needs
  the Electron runtime (`pnpm --filter @ciele/desktop electron:install`) plus a
  prior `pnpm build`.
- **Never call `app.getVersion()` directly — use `appVersion()`.** Unpackaged,
  Electron reports *its own* version (43.3.0), not the app's, because there is
  no bundle whose manifest it could read. Taken at face value a dev build then
  looks stamped, and both consequences are silent: it nags about updates against
  releases that do not exist, and pins the local stack to an image tag nobody
  will publish. This cost a CI run to find, because the packaged app CI drives
  is the one case where `getVersion()` is right and every local run is the case
  where it is wrong.
- **The smoke behaves differently with and without `dist/`.** It drives the
  packaged `.app` when one is there and `out/main/index.js` otherwise, and those
  differ in `app.isPackaged` — which is exactly what the trap above turns on. If
  a smoke change touches version, packaging or resource paths, run
  `pnpm package:mac` first and re-run it against the bundle.
- **Secrets logic is duplicated by design** with `deploy/bootstrap.sh` (see the
  README). Change one, check the other and both test suites.
- **The fake env template is one constant**, `setup/testing/env-template.ts`,
  shared by the engine tests and `--fake-ports`, and pinned to the real
  `deploy/.env.example` by `env-template.test.ts`. Change a key the wizard
  touches in either place and that test is what tells you about the other.
- The palette in `renderer/styles.css` is copied from `apps/web`'s dark theme
  token for token. It is greyscale product-wide; the only hue is `danger`.
  Do not introduce a brand accent here — the user crosses from these screens
  into the product in the same window.
