# SSRF & egress-hardening policy — `api_request` Flow Action

> Research asset for issue **#173** (policy) — implemented verbatim by issue **#177** (runtime
> executor + template engine), with the settings schema from **#175** and the template catalog
> from **#171**. Part of **#170** (API request flow action — reference parity).
>
> Scope: the server-side runtime executes an **admin-configured** HTTP request during a chat turn
> (method, URL, auth, headers, query params, JSON body), with **user-controlled** template
> variables (`{{user.name}}`, `{{user.email}}`, conversation metadata) interpolated into it, and
> JSON-path extraction over the response. The request leaves from Vercel's function
> infrastructure, so this is a classic SSRF surface (attacker goals: cloud metadata endpoints,
> internal services, request smuggling via headers, and data exfiltration via host injection).

> **Update (2026-07-12)** — the shared guard this policy specifies shipped in **#188**
> (`apps/web/src/lib/runtime/egress.ts`: `validateEgressTarget` + `pinnedRequest` + `egressFetch`,
> with `crawl-target.ts`/`pinned-fetch.ts` as thin wrappers). That PR also migrated the
> previously-unguarded call sites flagged in §8 — `tools.ts` (`fetchUrl` + custom HTTP tools) and
> `extract.ts` (`EXTRACTORS.url`) — onto the shared guard, so the "gap" verdicts in the §8 table are
> now **resolved** (kept below as the original audit record). The remaining consumer is the
> `api_request` executor (#184), which builds on this same module and adds the auth composition and
> header policy (§6) specific to admin-configured requests. Ticket numbers elsewhere in this doc
> (#171/#175/#177) predate the re-planned route — the live implementation issues are #183 (template
> engine, merged) and #184 (executor).

## Policy summary

| # | Rule | Value |
|---|------|-------|
| 1 | Allowed URL schemes | `https:` always; `http:` **only when `VERCEL_ENV !== "production"`**. Everything else (`file:`, `ftp:`, `data:`, `ws:`, …) rejected at config time and at runtime |
| 2 | Embedded credentials in URL (`user:pass@`) | Rejected (crawler parity, `crawl-target.ts`) |
| 3 | Blocked hostnames (literal) | `localhost`, `*.localhost`, `metadata.google.internal`, `*.internal`, `*.local` |
| 4 | Blocked IPv4 (checked on **every resolved address**) | `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/3` |
| 5 | Blocked IPv6 (ditto) | `::` (unspecified), `::1` (loopback), `fc00::/7` (unique-local), `fe80::/10` (link-local), `ff00::/8` (multicast); `::ffff:0:0/96` (IPv4-mapped) unwrapped and re-checked against the IPv4 list |
| 6 | Validation timing | At DNS-resolution time: `dns.promises.lookup(host, { all: true, verbatim: true })`, **all** returned addresses must pass |
| 7 | DNS rebinding | Resolve-then-connect **pinning** via Node `http/https.request` custom `lookup` (reuse `pinned-fetch.ts`); URL hostname retained for Host/SNI/cert verification |
| 8 | Redirects | **Not followed.** Any 3xx response = failed request. (No cap-and-revalidate loop for v2; see §3) |
| 9 | Total timeout | **10 s** per request (`AbortSignal.timeout(10_000)` combined with the turn signal via `AbortSignal.any`) — keep v1's value |
| 10 | Response size cap | **1 MiB**, enforced by counting bytes on the response stream and destroying the request past the cap; `Content-Length > cap` fails fast but is never trusted as sufficient |
| 11 | Content type for JSON-path extraction | Advisory only: attempt `JSON.parse` when extraction is configured; a body that fails to parse ⇒ extraction fails (empty variables + flagged event), the HTTP call itself is still reported by status |
| 12 | Template variables in the URL | **Never in scheme/host/port.** The URL template's origin must be static at config time (no `{{…}}` before the path); interpolated values allowed in path segments and query values only, `encodeURIComponent`-escaped per slot |
| 13 | Template variables in headers/body | Header **values** only (never names), CR/LF/NUL stripped; body built as a JS object → `JSON.stringify` (JSON-string escaping), never string splicing |
| 14 | Admin-settable headers | Denylist (case-insensitive): `host`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `keep-alive`, `te`, `trailer`, `expect`, and any name starting `proxy-` or `sec-`. Names must match the HTTP token charset. `authorization`, `cookie`, `content-type`, `x-*` are allowed |
| 15 | Failure semantics | Guard throws a typed `EgressPolicyError` (name + machine `code`); widget visitor sees only the generic failure text; the resolved IP and internal error details are **never** emitted to the widget |
| 16 | Implementation | Zero-dep, in-tree: generalize the existing `crawl-target.ts` + `pinned-fetch.ts` pair (internal files of the runtime deep module). No `ssrf-req-filter` / `request-filtering-agent` dependency |

---

## 1. Scheme allowlist

**Rule:** accept only `https:` in production; additionally accept `http:` when
`VERCEL_ENV !== "production"` (preview + local dev, where test endpoints are commonly plain-HTTP
`localhost` servers — see the dev carve-out in §2). Reject everything else — `file:`, `ftp:`,
`data:`, `blob:`, `ws(s):` — both in the settings-save server action (#175) and again in the
runtime guard (defense in depth; settings rows can be written by older code or direct DB access).

Rationale:

- OWASP's SSRF cheat sheet (Case 2, URLs not fully known in advance) says to validate the scheme
  against an allowlist and permit only HTTP/HTTPS. ([OWASP SSRF Prevention Cheat Sheet][owasp])
- We tighten that to HTTPS-only in production because `api_request` carries **admin secrets**
  (auth from #172) and **user PII** (interpolated `{{user.email}}` etc.); sending either in
  cleartext to the public internet is not acceptable. (Product decision, not an OWASP citation.)
- Crawler precedent: `validateCrawlTarget` already rejects non-HTTP(S) schemes
  (`apps/web/src/lib/runtime/crawl-target.ts:103-107`).

Also reject URLs carrying embedded credentials (`https://user:pass@host/`) — crawler precedent at
`crawl-target.ts:108-112`; credentials belong in the #172 auth config, not the URL.

## 2. IP/host blocking and DNS rebinding

**Rule:** validate at **DNS-resolution time**, not by hostname-literal inspection, then **pin** the
connection to the validated addresses.

1. Normalize the hostname (strip brackets, trailing dot, lowercase — `crawl-target.ts:77-79`).
2. Reject blocked hostnames literally: `localhost`, `*.localhost`, `metadata.google.internal`
   (crawler parity), plus `*.internal` and `*.local` (defense in depth for split-horizon DNS names;
   additive over the crawler's list).
3. If the host is an IP literal (`net.isIP` returns `4`/`6`; `0` = not an IP —
   [Node `net` docs][node-net]), check it directly. Otherwise resolve with
   `dns.promises.lookup(hostname, { all: true, verbatim: true })` — `all: true` resolves the
   promise with *every* address as `{ address, family }[]` ([Node `dns` docs][node-dns]) — and
   require **all** addresses to pass. One private A/AAAA record among public ones is a rebinding
   primitive, so any blocked address fails the whole request.
4. Blocked ranges (identical to the crawler's `isBlockedIpv4`/`isBlockedIpv6`,
   `crawl-target.ts:16-75`):

   | Range | Why | Source |
   |---|---|---|
   | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | private-use | [RFC 1918 §3][rfc1918] |
   | `127.0.0.0/8` | loopback | [RFC 6890][rfc6890] / IANA IPv4 special-purpose registry |
   | `169.254.0.0/16` | link-local — includes the cloud metadata endpoint `169.254.169.254` | [RFC 3927][rfc3927]; metadata risk called out by [OWASP][owasp] |
   | `0.0.0.0/8` | "this network" / unspecified | [RFC 6890][rfc6890] |
   | `100.64.0.0/10` | carrier-grade NAT shared space | [RFC 6598][rfc6598] |
   | `198.18.0.0/15` | benchmarking | [RFC 2544][rfc2544] |
   | `224.0.0.0/3` | multicast (`224/4`) + reserved (`240/4`) + broadcast | [RFC 6890][rfc6890] |
   | `::`, `::1` | unspecified / loopback | [RFC 4291 §2.5.2–2.5.3][rfc4291] |
   | `fc00::/7` | unique-local | [RFC 4193][rfc4193] |
   | `fe80::/10` | link-local | [RFC 4291 §2.5.6][rfc4291] |
   | `ff00::/8` | multicast | [RFC 4291 §2.7][rfc4291] |
   | `::ffff:0:0/96` | IPv4-mapped — unwrap and re-check the embedded IPv4 | [RFC 4291 §2.5.5.2][rfc4291] |

   OWASP recommends deriving such blocklists from the official IANA special-purpose registries
   rather than re-deriving them ([OWASP][owasp]); the set above matches the crawler's shipped,
   test-covered implementation.

**DNS rebinding stance — pin, don't re-resolve.** OWASP says to resolve A/AAAA records and validate
them **before** making the request, precisely to counter rebinding ([OWASP][owasp]). But
validate-then-`fetch(url)` still re-resolves inside the HTTP client (TOCTOU). The repo already
closes this gap for the crawler: `pinned-fetch.ts` issues the request through `node:http`/`node:https`
`request()` with a custom `lookup` option that returns only the pre-validated addresses, while
keeping the URL hostname for the `Host` header, TLS SNI (`servername`) and certificate
verification (`apps/web/src/lib/runtime/pinned-fetch.ts:15-55`). Node's `http.request` accepts a
custom `lookup` function (default `dns.lookup`) for exactly this ([Node `http` docs][node-http]).
**Reuse this** — extend `fetchPinnedPage` (today GET-only) to accept method + body, or add a
sibling `pinnedRequest`.

Why not undici's `Agent`/connector? undici's `buildConnector` accepts the `tls.connect`/`net.connect`
option surface (which includes `lookup`) and a custom `connect` callback
([undici Connector docs][undici-connector]), so an equivalent build is possible — but `undici` is
**not a direct dependency** of `apps/web` (only transitive via the lockfile), Next.js patches global
`fetch`, and the `node:http` pinning path is already proven in production by the local crawler.
Zero new deps (stack preference), one shared implementation.

**Dev carve-out:** when `VERCEL_ENV !== "production"`, allow loopback (`127.0.0.0/8`, `::1`,
`localhost`) so admins can point a flow at a local test endpoint. All other blocked ranges stay
blocked even in dev. Gate this on one explicit boolean parameter of the guard (unit-testable), not
on ambient env reads scattered through the code.

**Optional simplification:** Node's `net.BlockList` (v15.0.0+) supports `addSubnet`/`addRange`/
`check` for IPv4 + IPv6 and matches IPv4-mapped IPv6 forms of blocked IPv4 addresses
([Node `net` docs][node-net]). The hand-rolled checkers in `crawl-target.ts` are equivalent,
already tested (`ingest.security.test.ts`), and portable to non-Node runtimes — keep them; treat
`BlockList` as an acceptable refactor, not a requirement.

## 3. Redirect policy

**Rule: do not follow redirects.** Any 3xx response fails the request (same user-visible outcome as
a 5xx).

- OWASP is explicit: when accepting user-supplied URLs, "don't forget to disable the support for
  redirection in the web client used" — a redirect after validation is the canonical
  validated-host → internal-host bypass. ([OWASP][owasp])
- JSON APIs — the target of this action — do not legitimately need cross-host redirect chains the
  way crawled websites do. The crawler *does* follow redirects (≤5 hops) because websites redirect
  routinely, and it re-runs `validateCrawlTarget` on **every** hop and additionally forbids
  cross-origin hops (`local-crawl.ts:31-65`). If a real product need for redirects appears later,
  adopt exactly that loop (cap ≤ 3, per-hop scheme/host/IP re-validation, re-pin per hop); until
  then the simple rule is safer and cheaper.
- Mechanics: the pinned `node:http` path never follows redirects (Node's HTTP client has no
  redirect support), so "3xx ⇒ fail" is the natural behavior — just branch on
  `status >= 300 && status < 400`. For reference, WHATWG-fetch clients default to `redirect: "follow"`
  with a hard limit of 20 before a network error, and offer `"error"` / `"manual"` modes
  ([Fetch spec, request redirect modes & HTTP-redirect fetch][fetch-redirect]); undici's fetch
  deviates from the browser spec in `"manual"` mode by returning the real 3xx with a readable
  `Location` instead of an opaque-redirect filtered response
  ([undici PR #1210][undici-1210], merged 2022-02-08). We don't rely on any of that — but it
  matters for the audit in §8: **v1's `fetch(settings.url)` silently follows up to 20 redirects
  today.**

## 4. Timeout & size caps

**Timeout: keep 10 s total**, exactly as v1: `AbortSignal.timeout(10_000)` merged with the turn's
signal via `AbortSignal.any([...])` so the caller's cancellation still wins.
`AbortSignal.timeout` (Node v17.3.0/16.14.0) aborts with a `TimeoutError` after the delay;
`AbortSignal.any` (Node v20.3.0/18.17.0) aborts with the first inner signal's reason
([Node globals docs][node-globals]). Both are safely available (the repo targets Node ≥20 —
`@types/node ^20`, local toolchain on 24). Budget context: Vercel functions with fluid compute
default to a **300 s max duration** on every plan ([Vercel duration docs][vercel-duration]), so
10 s is not runtime-constrained — it's a chat-UX bound: a flow turn stalled 10 s behind a
third-party API is already at the edge of acceptable. Apply the same timeout to the admin-facing
"Test request" path (#175) for parity. On the pinned `node:http` path, wire the merged signal via
`request.destroy()` on `signal.abort` plus `request.setTimeout` as the socket-level backstop
(pinned-fetch precedent, `pinned-fetch.ts:86-88`).

**Size cap: 1 MiB**, enforced on the stream: count bytes per `data` chunk and `request.destroy()`
past the cap (precedent: `pinned-fetch.ts:62-72`, which uses 5 MiB for crawled pages). JSON-path
extraction buffers and `JSON.parse`s the whole body in the function's memory, so the cap must be
byte-accurate, not post-hoc. If a `Content-Length` header is present and exceeds the cap, fail
before reading the body — but never treat its absence or a small value as sufficient (chunked
transfer encoding carries no length). Do **not** copy v1-adjacent patterns that call
`res.text()` first and slice afterwards (see §8, `tools.ts`): that reads an unbounded body into
memory before truncating.

**Content type:** advisory, not a gate. When JSON-path extraction is configured, attempt
`JSON.parse` on the (≤1 MiB) body regardless of `Content-Type` — real-world APIs frequently
mislabel JSON as `text/plain`. Parse failure ⇒ extraction yields no variables and the runtime
emits a flagged event (admin-visible), while the chat part still reports the HTTP outcome by
status. Record the declared content type in the event for debugging. (Product decision; no
first-party source mandates either stance.)

## 5. Template values in the URL — host must be static

**Rule: interpolated variables must never reach the scheme, host, or port.** If a template token
could land in the host, a chat visitor could steer the request — including its #172 auth
credentials — to a server they control (host injection + credential exfiltration), defeating every
check that ran against the configured host.

Enforcement, twice:

- **Config time (#175 schema):** parse the URL template; reject if any `{{…}}` token appears at or
  before the end of the origin (scheme + `//` + host + port). Concretely: replace every token with
  a benign placeholder (`x`), `new URL()` it, then verify the origin equals the origin of the
  template with tokens **removed** — any difference means a token influenced the origin.
- **Runtime (#177 executor):** interpolate only into path segments and query values; after
  interpolation, `new URL()` the result and assert `url.origin` strictly equals the config-time
  origin. Belt and braces against encoded tricks (`%2F`, `@`, backslashes) — the origin comparison
  is the invariant, not the token-position heuristic.

**Per-slot escaping** (this is the shared template engine's job, #171/#177):

| Slot | Escaping |
|---|---|
| URL path segment | `encodeURIComponent` |
| Query value | `url.searchParams.set(key, value)` (WHATWG URL API encodes) or `encodeURIComponent` |
| Header value | strip `\r`, `\n`, `\0`; no other escaping (header values are opaque bytes) |
| JSON body | build the body as a JS object and `JSON.stringify` it — values are escaped as JSON strings by construction; never splice raw text into a JSON template string |

Precedent to replace: `resolveButtonTemplate` (`actions.ts:32-40`) does raw `String.replace` with
no escaping — acceptable for button *labels*, not for URLs/headers/JSON.

## 6. Header restrictions

Admins configure header name/value pairs (#175). Do **not** rely on the platform to police them:
undici deliberately does not enforce the browser "forbidden request headers" list server-side
([undici issue #2319][undici-2319], [docs gap #1470][undici-1470]) — the only hard platform block
is `host`, added in a security release ([undici issue #2369][undici-2369]) — and our pinned
`node:http` path enforces nothing at all. So the guard owns an in-app denylist, derived from the
Fetch spec's forbidden-header list ([Fetch spec §2.2.2][fetch-forbidden]) minus the browser-only
entries we deliberately allow:

- **Denied (case-insensitive):** `host` (spoofs virtual-host routing and breaks the pinning
  model), `content-length`, `transfer-encoding`, `connection`, `upgrade`, `keep-alive`, `te`,
  `trailer`, `expect` (framing / request-smuggling vectors), and any name with a `proxy-` or
  `sec-` prefix (per the Fetch spec's blanket prefix rule).
- **Allowed:** `authorization`, `cookie`, `content-type`, `accept`, `user-agent`, and arbitrary
  `x-*`/custom names — these are the point of the feature (calling the org's own APIs). The
  browser reasons for forbidding `cookie`/`referer`/`origin` (user-agent control) don't apply to a
  server-to-server call made on the admin's behalf.
- **Validation:** header names must match the HTTP token charset (`/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/`);
  values get CR/LF/NUL stripped after interpolation (§5). `content-length` is always computed by
  the client from the actual body.

The runtime sets `content-type: application/json` by default (v1 behavior) unless the admin
overrides it, plus a stable `user-agent` identifying the platform (crawler precedent:
`local-crawl.ts:26-27`).

## 7. What Node-on-Vercel gives us (and doesn't)

Verified against the repo and live docs:

- **Node version:** no `engines` field anywhere in the monorepo; `apps/web` has `@types/node ^20`;
  local toolchain is v24. The deployed version is whatever the Vercel project setting selects.
  **Implementation note:** pin it (project setting or `engines`) so the guard's platform
  assumptions (below) are stable.
- **Available natively:** `AbortSignal.timeout` (v17.3+), `AbortSignal.any` (v20.3+)
  ([Node globals][node-globals]); `net.isIP` / `net.BlockList` (v15+) ([Node net][node-net]);
  `dns.promises.lookup` with `all: true` (uses the OS `getaddrinfo`, so it honors `/etc/hosts` —
  fine for our purpose since we pin to whatever it returns) ([Node dns][node-dns]);
  `http/https.request` with custom `lookup` ([Node http][node-http]).
- **Not available:** any built-in private-IP / SSRF guard. Neither Node nor undici ships one; range
  checking is always application code.
- **undici:** present only transitively (lockfile `undici@7.28.0` via other packages), not a
  dependency of `apps/web`. Global `fetch` is Node's bundled undici, further wrapped by Next.js.
  This is why the guard goes through `node:http(s)` directly (pinned-fetch precedent) instead of a
  custom undici `Agent`.
- **Third-party options considered and rejected:** `ssrf-req-filter`, `request-filtering-agent`
  (free, agent-based private-IP filters). The repo already contains a superior in-tree equivalent
  — `crawl-target.ts` (133 lines) + `pinned-fetch.ts` (91 lines), test-covered — and the stack
  preference is zero new deps. Nothing to add.
- **Vercel egress:** no platform-level outbound restrictions apply by default; function duration
  defaults to 300 s (fluid compute, all plans), max 800 s on Pro/Enterprise
  ([Vercel duration docs][vercel-duration]) — comfortably above our 10 s cap.

## 8. Repo audit — existing server-side fetches of admin/user-supplied URLs

All paths relative to the repo root (audited on the `contact-support-email-button` worktree).

| Call site | URL provenance | Protections today | Verdict |
|---|---|---|---|
| `apps/web/src/lib/runtime/actions.ts:507-537` — `apiRequest` handler (**the subject**) | admin (flow settings, URL + GET/POST only) | 10 s timeout + turn signal via `AbortSignal.any`. **No** scheme check, **no** IP/host guard, **no** redirect control (global fetch defaults to `follow`, up to 20 hops per spec), body never read (so no size exposure yet) | v1 acknowledged as unguarded (`agents.md`/CLAUDE.md call auth/headers/etc. "next deepening"); #177 replaces it under this policy |
| `apps/web/src/lib/runtime/tools.ts:210-238` — `fetchUrl` built-in tool (default **off**) | **model/visitor** (LLM-chosen URL) | scheme allowlist; `isBlockedHost` (`tools.ts:54-70`) — literal-only: `localhost`, `*.local`, `::1`, dotted-quad IPv4 regex | **Weak**: no DNS resolution (any hostname resolving to a private IP passes; rebinding trivially possible), no IPv6 beyond `::1`, decimal/hex IPv4 literals (`http://2130706433/`) bypass the regex, redirects followed, and `res.text()` reads an **unbounded** body before slicing to 6000 chars. Should be migrated to the shared guard (follow-up, not #177) |
| `apps/web/src/lib/runtime/tools.ts:316-352` — custom HTTP tools (`assistant.tools.custom`) | admin URL + model-supplied params | same `isBlockedHost` literal check; same unbounded `res.text()`; redirects followed | Same weaknesses; same follow-up |
| `apps/web/src/lib/runtime/crawl-target.ts` (+ `ingest.security.test.ts`) | — (validator) | scheme, credential, hostname, resolution-time IPv4/IPv6 range checks incl. IPv4-mapped; runs "before any crawler provider receives the URL" | **The precedent to generalize** |
| `apps/web/src/lib/runtime/pinned-fetch.ts` | — (transport) | DNS pinning via custom `lookup`, SNI/Host preserved, 5 MiB streamed cap, socket timeout | **The transport to generalize** (add method/body/headers-in, abort-signal wiring) |
| `apps/web/src/lib/runtime/local-crawl.ts:31-65` | admin (website source) | per-hop re-validation, same-origin-only redirects, ≤5 hops, page/time budgets | Redirect-loop pattern if we ever allow redirects |
| `apps/web/src/lib/runtime/extract.ts:64-69` — `EXTRACTORS.url` (knowledge "add URL") | admin | **None** — bare `fetch(input.url)`: no scheme/IP guard, no timeout, no size cap, redirects followed | **Gap flagged** — out of #177 scope; needs its own ticket to route through the shared guard |
| `apps/web/src/lib/runtime/crawl4ai.ts:251,297`, `services/crawl4ai-worker` submit/poll | trusted (`CRAWL4AI_BASE_URL` env) | env-configured operator endpoint | Fine — not admin/user input. Note: admin URLs sent to remote providers (Crawl4AI/Apify) are validated by `validateCrawlTarget` **before dispatch**, but the remote worker fetches from *its* network — private ranges there differ from Vercel's (documented residual, see `docs/runbooks/website-crawler-providers.md`) |
| `apps/web/src/lib/runtime/apify.ts:155,187,215` | trusted (Apify API, constant host) | token auth | Fine |
| `apps/web/src/lib/runtime/validate-key.ts:66` | trusted (constant provider probe URLs) | 8 s timeout | Fine |

**Conclusion:** the crawler already solved scheme/IP/resolution-time validation, DNS pinning,
streamed size caps, and safe redirect handling. #177 should not write a new guard — it should
**promote the crawler's guard to a shared egress module** and route `api_request` (and, in
follow-ups, `fetchUrl`, custom tools, and `extract.ts`) through it.

## 9. Failure semantics

- The guard throws one typed error class, e.g. `EgressPolicyError extends Error` with
  `name = "EgressPolicyError"` and a machine-readable `code`:
  `"scheme" | "credentials" | "blocked_host" | "blocked_address" | "resolution_failed" |
  "template_in_origin" | "forbidden_header" | "redirect" | "timeout" | "too_large"`.
  (Precedent: `UnsafeCrawlTargetError`, `crawl-target.ts:4-9`.)
- **Widget visitor** always sees the existing generic part text ("Sorry — that request couldn't be
  completed right now."), identical for policy blocks, network failures, timeouts, and non-2xx —
  the visitor must not be able to distinguish "blocked" from "down" (that distinction is an
  internal-network oracle). Never include the URL, resolved IPs, status codes, or error messages
  in any part emitted to the widget.
- **Admin surfaces** (the #175 "Test request" flow-builder path, runtime events/observability) may
  show the `code` and a human summary ("Blocked: the endpoint resolves to a private address") —
  but still **never the resolved IP addresses** themselves; the admin already knows the hostname,
  and the resolved-IP list is internal reconnaissance data if the admin account is compromised.
- Emit the structured tool-lifecycle events (ADR-0006) with the outcome category so Alerts/Insights
  producers can later aggregate egress failures without parsing strings.

## Implementation notes for #177

Respecting the runtime deep-module rule (ADR-0005-runtime-as-enforced-deep-module: internal files,
import only via the `@/lib/runtime` barrels, `interface.test.ts` locks the surface):

1. **`apps/web/src/lib/runtime/egress.ts`** (new internal file, pure + unit-testable):
   - Generalize `crawl-target.ts` into `validateEgressTarget(rawUrl, { allowHttp, allowLoopback })`
     returning `{ url, addresses }`, throwing `EgressPolicyError`. Either re-export the range
     checkers from `crawl-target.ts` or move them here and make `crawl-target.ts` a thin wrapper
     that maps `EgressPolicyError` → `UnsafeCrawlTargetError` (keeps `ingest.security.test.ts`
     green and one source of truth for the ranges).
   - Add `assertAllowedHeaders(headers)` (§6 denylist + token charset) and
     `sanitizeHeaderValue(value)` (CR/LF/NUL strip) here — pure functions.
2. **`apps/web/src/lib/runtime/pinned-fetch.ts`**: extend to
   `pinnedRequest(target, { method, headers, body, timeoutMs, signal, maxBytes })` — same lookup
   pinning, add method/body, wire the merged `AbortSignal` to `request.destroy()`, parameterize the
   byte cap (1 MiB for api_request, keep 5 MiB for crawl). Treat 3xx as a terminal status (no
   follow).
3. **Template engine** (§5): interpolation happens **before** `validateEgressTarget` for
   path/query (so the final URL is what gets validated) but the static-origin assertion compares
   against the config-time origin. Per-slot escaping lives in the shared engine module (#171),
   replacing `resolveButtonTemplate`.
4. **`actions.ts` `apiRequest`**: settings (#175) → template resolution → header/origin assertions
   → `validateEgressTarget` → `pinnedRequest` → status branch → JSON-path extraction (§4) →
   events + parts (§9). Keep the handler thin; every rule above must be reachable by a unit test
   without a socket (mock `lookup`/transport at the `pinned-fetch` seam).
5. **Tests**: table-driven cases for every row of the policy summary (schemes, each blocked range,
   IPv4-mapped IPv6, decimal-IP literals, multi-record partial-private resolution, token-in-origin
   rejection, header denylist, CRLF stripping, 3xx failure, byte-cap destroy, timeout reason,
   error-code mapping). `ingest.security.test.ts` is the style precedent.
6. **Out of scope for #177, ticketed separately:** migrate `tools.ts` `fetchUrl` + custom tools and
   `extract.ts` `EXTRACTORS.url` onto `validateEgressTarget`/`pinnedRequest` (§8 findings).

## Source list

- [OWASP SSRF Prevention Cheat Sheet][owasp] — scheme allowlist, resolve-before-request, disable
  redirects, IANA-registry-derived blocklists, metadata-endpoint risk.
- Node.js docs: [dns][node-dns] (`dns.promises.lookup` `all`/`order`), [net][node-net]
  (`net.isIP`, `net.BlockList` incl. IPv4-mapped matching), [globals][node-globals]
  (`AbortSignal.timeout` v17.3+, `AbortSignal.any` v20.3+), [http][node-http] (`request` `lookup`
  option).
- [Fetch spec][fetch-forbidden]: forbidden request-header names (§2.2.2); redirect modes and the
  20-redirect network-error limit ([HTTP-redirect fetch][fetch-redirect]).
- undici: forbidden headers deliberately not enforced server-side ([#2319][undici-2319],
  [#1470][undici-1470]); `host` header blocked in security releases ([#2369][undici-2369]);
  `redirect: "manual"` returns the real 3xx ([PR #1210][undici-1210]);
  [Connector docs][undici-connector] (custom `connect`, `tls.connect` option surface).
- [Vercel function duration docs][vercel-duration] — 300 s default / 800 s max (fluid compute).
- RFCs for ranges: [1918][rfc1918], [3927][rfc3927], [4193][rfc4193], [4291][rfc4291],
  [6598][rfc6598], [2544][rfc2544], [6890][rfc6890].
- Repo: `apps/web/src/lib/runtime/{actions,tools,crawl-target,pinned-fetch,local-crawl,extract}.ts`,
  `ingest.security.test.ts`, `docs/runbooks/website-crawler-providers.md`, issues #170–#177.

**Claims not verified against a primary source** (disclosed per the research brief):

- The exact wording of the Fetch spec's 20-redirect step was confirmed via secondary search
  results pointing at the spec anchor, not read verbatim from the spec text (the section was
  beyond the fetched excerpt).
- undici's Connector documentation does not explicitly document a custom `lookup` function; that
  it works via the `tls.connect`/`net.connect` option pass-through is an inference (moot — we use
  `node:http` directly).
- The Node.js version actually running on the deployed Vercel project (no `engines` pin in the
  repo; recommendation §7 is to pin it).

[owasp]: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
[node-dns]: https://nodejs.org/api/dns.html
[node-net]: https://nodejs.org/api/net.html
[node-globals]: https://nodejs.org/api/globals.html
[node-http]: https://nodejs.org/api/http.html
[fetch-forbidden]: https://fetch.spec.whatwg.org/#forbidden-request-header
[fetch-redirect]: https://fetch.spec.whatwg.org/#http-redirect-fetch
[undici-2319]: https://github.com/nodejs/undici/issues/2319
[undici-1470]: https://github.com/nodejs/undici/issues/1470
[undici-2369]: https://github.com/nodejs/undici/issues/2369
[undici-1210]: https://github.com/nodejs/undici/pull/1210
[undici-connector]: https://github.com/nodejs/undici/blob/main/docs/docs/api/Connector.md
[vercel-duration]: https://vercel.com/docs/functions/configuring-functions/duration
[rfc1918]: https://www.rfc-editor.org/rfc/rfc1918
[rfc3927]: https://www.rfc-editor.org/rfc/rfc3927
[rfc4193]: https://www.rfc-editor.org/rfc/rfc4193
[rfc4291]: https://www.rfc-editor.org/rfc/rfc4291
[rfc6598]: https://www.rfc-editor.org/rfc/rfc6598
[rfc2544]: https://www.rfc-editor.org/rfc/rfc2544
[rfc6890]: https://www.rfc-editor.org/rfc/rfc6890
