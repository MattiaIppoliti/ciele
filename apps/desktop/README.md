# apps/desktop, `@ciele/desktop`

Ciele Desktop: an Electron shell whose first screen offers two ways in, sign in
to your organization, or stand up a complete Ciele on this machine. The product
UI is the existing web app; this workspace owns only the welcome screen, the
setup wizard and the stack status screen.

User documentation lives at [`/self-hosting/desktop`](https://docs.ciele.app/self-hosting/desktop).
This file is for people changing it.

## Commands

```bash
pnpm --filter @ciele/desktop electron:install   # fetch the Electron runtime (once)
pnpm --filter @ciele/desktop dev                # electron-vite dev, with HMR
pnpm --filter @ciele/desktop build              # bundle main + preload + renderer
pnpm --filter @ciele/desktop test               # vitest, the engine and the pure modules
pnpm --filter @ciele/desktop typecheck          # both tsconfigs
pnpm --filter @ciele/desktop lint
pnpm --filter @ciele/desktop package:mac        # unsigned .app + .zip into dist/
pnpm --filter @ciele/desktop package:win        # unsigned NSIS Setup.exe into dist/ (Windows host)
pnpm --filter @ciele/desktop test:e2e           # Playwright, against a built or packaged app
```

Electron 43 dropped its `postinstall` in favour of an `install-electron` bin, so
the runtime binary is fetched explicitly rather than on every install in the
monorepo, most work here never needs it, and it is ~100 MB.

Developing on Windows needs nothing beyond the repo's usual Node 22 + pnpm,
every command above works there, `package:win` produces the unsigned NSIS
installer plus the `dist/win-unpacked/` build the smoke drives, and testing the
wizard against a real stack needs Docker Desktop for Windows (WSL2 or Hyper-V
backend, either works). Run the commands from a shell with bash semantics (Git
Bash or WSL) or plain PowerShell, none of them depend on a Unix shell.

Run the whole flow without Docker with `--fake-ports`:

```bash
pnpm --filter @ciele/desktop dev -- --fake-ports
```

## Layout

```
src/
  setup/      the setup engine, pure, framework-free, ports-injected
  main/       Electron main: windows, settings, IPC, the real ports
  preload/    the entire bridge, one file
  renderer/   React: welcome, wizard, settings, stack status
  shared/     types all three processes agree on
e2e/          the Playwright Electron smoke
```

## Where the design lives

**`src/setup/` is the deep module, and the only one.** The steps are data,
each with `execute` and `verify` over five injected ports (docker, fs, probe,
crypto, clock). It imports no `electron`, no `node:*`, no React. That is why
the wizard's behaviour can be tested exhaustively against scripted fakes, and
why `--fake-ports` is one substitution rather than a parallel code path. Same
pattern as the agent package's host ports and the `Db` seam.

The rule the wizard rests on is **execute, then verify, and only a passing
verify unlocks the next step**. `docker compose up` exits 0 long before
anything is serving, so a step that trusted its own exit code would put a green
check on a stack that is not there.

**The run stops in front of an optional step rather than through it.**
"Optional" that happens to you anyway is not optional. The required chain runs
unattended; each choice is asked.

**Two BrowserWindows, not one that re-navigates.** `webPreferences` are fixed at
creation, and the two postures differ: native screens are this app's own
renderer and get the preload bridge; the product window loads a remote origin
and gets no preload at all, in its own persistent session partition. Moving
*between* native screens re-routes the existing window (`showNative`) rather
than rebuilding it.

**Secret generation is `deploy/bootstrap.sh`'s block in TypeScript**, over the
crypto port, not a shell-out. A GUI-launched macOS app cannot count on bash and
openssl being on its PATH, and a wrongly signed JWT gives a stack that starts
cleanly and then 401s everything. `src/setup/secrets.test.ts` verifies the
signatures the same way `deploy/compose.test.mjs` does for the shell version;
if one changes, check the other.

**Docker is located explicitly** (`src/main/ports/docker.ts`). An app launched
from the Finder inherits none of the shell's PATH, so `spawn("docker")` fails
with ENOENT on a machine where the terminal finds it instantly.

## Testing

Breadth lives in `pnpm test`, the engine, the steps, the secrets, the stack
controller, the update check, all against `src/setup/testing/fake-ports.ts`.
The Electron glue has no unit tests; it is covered by the smoke.

`pnpm test:e2e` drives the packaged `.app` when `dist/` holds one and the built
`out/main/index.js` otherwise, so it runs locally after `pnpm build` without
waiting on electron-builder. It launches with `--fake-ports` and a throwaway
user-data directory per test. CI (`.github/workflows/desktop.yml`) packages
first, so what it drives is what a user would download.

## Deploy assets

`electron-builder.yml` copies `deploy/` into the packaged app's resources, so
the compose definition and env template are versioned with the build. Generated
configuration goes to the per-user data directory; the app's data lives in named
Docker volumes and outlives both.

## Beta constraints

Unsigned, macOS and Windows, no auto-update, an unsigned app cannot
auto-update, so `publish: null` and the app shows a notice linking the download
instead. First-open instructions ship in the release notes: Gatekeeper's
right-click-to-open on macOS, SmartScreen's "More info → Run anyway" on
Windows. Signing, notarization and Linux are post-beta; Windows is x64 only
for now.
