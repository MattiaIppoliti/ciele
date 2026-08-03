# Local AI subscription connections

> **Update (superseded in part):** the downloadable desktop connector
> (signed macOS `.pkg` / Windows `.exe`, the `/api/local-connector/download`
> route, the `local-connector-pkg.yml` + `local-connector-windows.yml` release
> workflows, their build scripts, and the `CIELE_CONNECTOR_PKG_URL` /
> `CIELE_CONNECTOR_WINDOWS_URL` config) has been removed. Members now pair the
> Ciele Connector solely through **Authorize from Terminal** — the one-line
> `curl … | sh` / `irm … | iex` installer served by
> `/api/local-connector/install/{sh,ps1}`, which downloads the same secret-free
> runtime from `/api/local-connector/runtime`. The runtime, loopback pairing,
> and tenant-scoping described below are unchanged; only the download/package
> distribution path is gone. Sections mentioning the `.pkg`/`.exe` packages are
> retained for historical context.

Ciele supports real local ChatGPT or Claude account authentication from the
existing **AI Providers** settings page. The opt-in development mode runs the
CLIs in the Ciele process; hosted settings use the downloadable desktop connector
described below. In direct development mode, the `Connect` menu lists
**ChatGPT Subscription** and **Claude Subscription** under the Subscription
heading and opens a Ciele popup that supervises the official provider CLI login.

This decision keeps subscription authentication owned by the official provider
CLIs (Codex CLI or Claude Code), not by Ciele's Vercel AI SDK API clients — the
same local-process boundary other coding tools that support subscription sign-in
use. No private OAuth endpoints are invented; the CLIs' own login flows are the
only authentication surface.

## Decision

The Organization owner must first enable **Allow personal AI subscriptions**.
After that, every authenticated Member may pair their own device; the capability
is scoped to that Member and Organization and is used only in Preview.

The direct, same-process development path is available only when all of these
conditions hold:

1. Ciele is running outside `NODE_ENV=production`.
2. `ENABLE_LOCAL_SUBSCRIPTION_TEST` is not set to `0` / `false` / `off`. The
   capability is **on by default** on a local instance: a Member who completed
   the terminal steps (`codex login`, `claude auth login --claudeai`) expects
   their own sign-in to be used, and a second opt-in flag only produced silent
   "no AI provider credential" fallbacks. The variable survives as an opt-out
   for reproducing hosted behaviour locally.
3. Ciele is opened through a loopback host — `localhost`, any `*.localhost`
   label, `127.0.0.1`, or `::1`, with or without a port. Both data layers
   qualify — the in-memory demo db and a locally-run
   Supabase-backed instance with real Organization members — because the API
   route still requires a signed-in Member of an Organization that enabled
   personal subscriptions, and the loopback restriction keeps a machine-global
   CLI identity from crossing to remote users.
4. The relevant official CLI is installed on the same machine as the Ciele web
   process: `codex` for ChatGPT or `claude` for Claude.
5. The signed-in Ciele Member belongs to an Organization that enabled personal
   subscriptions.

The executable paths can be overridden with `CODEX_CLI_PATH` and
`CLAUDE_CLI_PATH`.

The direct path spawns the CLI without a shell on every platform. POSIX keeps
`/usr/bin/env` as the launcher so a bare command still resolves through the
sanitized PATH; Windows has no such launcher, so the CLI is resolved to an
absolute runnable path first — `.exe` directly, an npm `.cmd` shim through the
JS entrypoint it names (run under Ciele's own Node binary), and `.ps1`/`.bat`
not at all, since executing those would require a shell and an execution-policy
bypass. This mirrors the resolution the shipped connector already performs on
the device side.

For ChatGPT, Ciele runs `codex login`, then verifies `codex login status`
reports **Logged in using ChatGPT**. For Claude, Ciele runs
`claude auth login --claudeai`, then verifies the JSON returned by
`claude auth status --json` reports `authMethod: "claude.ai"`. API-key or
Console authentication is not presented as a subscription connection.

The provider CLI opens and owns the real browser authentication flow. Ciele
does not receive, parse, copy, encrypt, or persist its access/refresh tokens.
The settings page reads the live CLI authentication status and, where the CLI
reports it, displays the real account label and subscription type. Disconnect
invokes the provider CLI logout and clearly warns that this signs the CLI out
on the local machine.

### Downloadable desktop connectors

Hosted Ciele settings cannot execute programs installed on a Member's device. Any
authenticated Member therefore sees **Install connector** when no connector is
paired. The OS picker offers two generic release artifacts:

- a signed and notarized macOS `.pkg` with pinned Apple Silicon and Intel Node
  runtimes and a per-user LaunchAgent; and
- an Authenticode-signed Windows x64 `.exe` built with NSIS. It requests
  `user` execution level, installs under `%LOCALAPPDATA%`, registers auto-start
  only under `HKCU`, and never prompts for administrator elevation. A pinned
  x64 Node runtime is bundled.

Both packages follow the same bootstrap flow:

1. they contain the versioned connector plus a pinned Node runtime, so
   installation does not depend on a terminal or npm;
2. they start the connector for the signed-in OS user on a stable loopback discovery port and
   reopens `/settings/ai`;
3. the browser generates the random bearer secret and binds the generic install
   to the current Member + Organization after detecting it; and
4. Ciele issues a second, one-time relay pairing code. The connector exchanges
   it for a revocable device token and begins polling for that Member's Preview
   model calls.

Signed release assets are configured through `CIELE_CONNECTOR_PKG_URL` and
`CIELE_CONNECTOR_WINDOWS_URL`. Preview deployments intentionally do not keep
the large generated binaries in Git. If both the configured URL and a local
release artifact are absent, the authenticated download route generates an
unsigned scripts-only macOS `.pkg` or a Windows setup ZIP instead of returning
an error document. The macOS package opens directly in Installer.app and runs
the per-user connector bootstrap; the Windows ZIP contains a double-click
`.cmd` and a PowerShell installer. Both verify the versioned connector and the
pinned Node download, install for the current OS user, and complete the same
Member + Organization pairing. The signed/notarized `.pkg` and signed `.exe`
remain the preferred production artifacts. The fallback macOS package may
require explicit approval in Privacy & Security; the Windows ZIP instructs the
Member to extract all files before setup and registers a per-user Apps &
Features uninstall entry.

The browser stores that pairing under a key scoped to the signed-in Ciele
member and organization, then talks directly to the connector. Every request
must match the exact Ciele origin, random bearer secret, and installation
scope. The connector answers Private Network Access preflights and exposes
only fixed status, login, logout, preference and relay-pairing operations. Clicking
**Connect** runs the allowlisted official CLI login command, which opens the
provider's real authentication page.

The LaunchAgent/Windows per-user startup entry intentionally runs one active
Ciele connector per OS user.
Pairing from another Member or Organization replaces the active browser scope;
the previous workspace can pair it again without reinstalling the package.

Once paired, settings show ChatGPT and Claude connection state plus an
effective default-model picker and follow-up settings. Provider rows
use distinct ChatGPT and Claude glyphs. The connector reads Codex's supported
`model/list` and `account/rateLimits/read` app-server methods, exposes the real
local model catalog, and renders each returned rate-limit window as percentage
used/remaining with its reset time. Codex can prove that a ChatGPT account
authenticated it, but does not expose paid-plan entitlement, so the UI
explicitly says the paid plan is not verified.

Alongside the package download, Settings exposes a **Configure from Terminal**
bottom sheet. It provides copyable official `codex login` / `claude auth login
--claudeai` commands and their read-only status checks. This is an alternative
way to authorize the provider CLIs, not a replacement for the local connector:
the desktop package is still required to bridge a hosted Ciele Preview to the CLI
on the Member's device. No Ciele pairing token or provider credential appears in
the displayed commands.

Claude Code exposes authentication and model aliases through its documented
CLI, but currently has no non-consuming command that returns account quota.
The connector therefore exposes its real model aliases and an explicit
"usage unavailable" explanation rather than fabricating a percentage or
starting a paid inference merely to obtain a rate-limit event.
After each relay-backed Preview inference, the connector records the input and
output token counts returned by either CLI and exposes per-provider cumulative
Preview totals, isolated by Member-and-Organization pairing scope. These local
totals complement provider quota windows. Completed turns are also written to
Ciele's normal server-side usage ledger; an aborted turn can still consume
provider tokens and therefore remains visible in the connector-local totals.

Because provider login status can be stale, Ciele runs one minimal
default-model inference probe before advertising the local capability; a
failing provider is excluded so another verified personal subscription can
answer the same Preview turn. The verdict is cached asymmetrically — a ready
provider for minutes, a refusal for seconds — so completing the terminal login
after the server started takes effect on the next turn instead of requiring a
restart.

The local default-model preference is source-qualified and persisted for the
active Member-and-Organization pairing scope. The settings UI uses only the
live catalog advertised by connected local CLIs; hosted Platform/BYOK/federated
models remain configured through their existing organization controls. The
Member can choose the Preview model without receiving Vercel or Supabase access.
Published traffic ignores this preference. Preview model calls use the
`LanguageModelV3` local adapter:
structured classification and Ciele tool calls remain server-side while the
selected provider CLI supplies model decisions and text.
The source-qualified default-model preference is sent with every Preview turn
and is accepted only when the paired relay currently verifies that provider;
browser storage alone cannot activate or redirect a local capability.

The Preview composer consumes the selected follow-up behavior. **Queue** keeps
messages in order and starts each only after the active turn finishes;
**Steer** cancels the active request and continues the same conversation with
only the newest message. The turn stream emits the conversation id before
generation begins so cancellation does not accidentally create a second
conversation.

## Runtime boundary

The connector does not turn consumer OAuth credentials into Anthropic/OpenAI
API keys. `subscription` database rows remain retired. Instead, a local
capability is injected into `resolveProviderCredential` only for the requesting
Member's Preview. In local demo mode the Next.js process invokes the CLI. In a
hosted deployment a short-lived Supabase relay job is claimed by that Member's
paired device; the existing server-side Flow router, ordered actions, RAG tool
loop, structured classification and streaming contract remain authoritative.

## Security properties

- The provider and command arguments come from a fixed allowlist; request data
  is never interpolated into a shell command.
- Direct same-process test-mode operations require an authenticated Member and
  a loopback request. The downloadable connector is available to authenticated Members;
  its local runtime subsequently trusts the installation's exact origin,
  member-and-organization scope, and random bearer secret.
- The same-process test path is hard-disabled in production, opt-in via
  `ENABLE_LOCAL_SUBSCRIPTION_TEST`, and loopback-only. It works against either
  data layer on a developer machine; production uses only the paired connector
  relay after Organization owner opt-in.
- CLI credentials remain in the provider's local credential store.
- Hosted-browser connector requests are restricted to IPv4 loopback, the exact
  Ciele origin, a member-and-organization installation scope, and a random
  browser-generated bearer secret. Relay pairing uses a separate one-time code;
  only its hash and the revocable device token hash are stored server-side.
- The relay exchange endpoint is intentionally reachable without a browser
  session because the desktop connector never receives Ciele cookies. It accepts
  only a size-bounded request containing a server-authenticated, high-entropy
  one-time code for the exact request origin. Unsigned public input is rejected
  before storage access; the session-protected pairing endpoint is the only
  place that can mint a valid code. Deployment-level rate limiting remains an
  additional defense against sustained traffic to this public endpoint.
- The two bootstrap endpoints are the only unauthenticated loopback routes:
  they remain origin-restricted and exist solely to install a browser-generated
  bearer secret and Member/Organization scope. Every subsequent browser request
  requires both values.
- Plain HTTP origins are accepted only for loopback development; hosted
  origins must use HTTPS.
- The macOS release build produces a Developer-ID-signable/notarizable flat `.pkg`
  containing the versioned connector and checksum-verified Node runtimes for
  Apple Silicon and Intel. It installs a per-user LaunchAgent.
- The Windows release build produces an Authenticode-signable NSIS `.exe` with
  `RequestExecutionLevel user`; all files, startup and uninstall metadata live
  under `%LOCALAPPDATA%` and `HKCU`, so installation requires no administrator.
- The generic package contains no Member, Organization, Ciele credential or
  provider credential. Browser bootstrap binds it after installation.
- No subscription state is published or made available to anonymous widgets.

## Rejected

- Simulated OAuth, fake accounts, or fake usage meters.
- Calling undocumented provider OAuth/token endpoints directly.
- Importing browser cookies, `auth.json`, Keychain entries, or Claude local
  credentials into Ciele.
- Passing consumer OAuth tokens to the Anthropic or OpenAI API SDK clients.
- Treating a successful login-status check as proof that inference works, or
  allowing a personal subscription to power published assistant traffic.
