# External cybersecurity skills review

Date: 2026-08-30

Reviewed commit: `4d4df7256e8ddfe1d97ef77180b9a5ef010a08b0`

Source catalog: [Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills/tree/main/skills)

## Executive summary

This review applied 234 external cybersecurity skills to Ciele in separate
subagents. New dispatches after catalog entry `0107` used Terra at the owner's
request. The completed set is entries `0001` through `0231`, plus `0234`,
`0237`, and `0240`. The source catalog contained 818 skills when it was
enumerated. The review stopped at the owner's request before the remaining 584
skills were dispatched.

The review was static and read-only. No production environment, cloud tenant,
account, credential, network target, malware sample, exploit, or active scanner
was used. Each subagent produced an evidence report outside the repository. This
document keeps only findings that survived a second deduplication pass; it does
not import the repetitive raw reports.

The highest-priority themes are:

1. fail-open secret storage and authorization order;
2. credential lifetime and host-derived trust decisions;
3. untrusted knowledge and memory entering LLM control context;
4. release, model, and container supply-chain assurance;
5. storage, security-event, and incident-response observability.

Severity is a repository-review priority, not a CVSS score. Runtime validation is
still required before treating a conditional deployment finding as exploitable.

## Prioritized findings

| ID | Severity | Finding | Primary evidence |
| --- | --- | --- | --- |
| CYB-01 | High | A PDF is parsed before membership authorization in the upload Server Action. | `apps/web/src/app/actions.ts:1040,1070-1090` |
| CYB-02 | High | Secret sealing silently falls back to plaintext when `APP_ENCRYPTION_KEY` is absent. | `packages/core/src/crypto.ts:35-48` |
| CYB-03 | High | Hosted MCP derives its authenticated internal API origin from the request host. | `apps/web/src/app/api/mcp/route.ts:24-37`; `packages/client/src/index.ts:227-243` |
| CYB-04 | High | API keys remain valid after their creating Member leaves or is removed. | `packages/ops/src/organization.ts:85-109`; `apps/web/src/lib/api-v1/auth.ts:57-69` |
| CYB-05 | High | Sensitive object downloads do not create a durable access event. | `apps/web/src/app/actions.ts:1406-1417`; widget source download route `:48-56` |
| CYB-06 | High | Local workers bind to all host interfaces; the crawler also disables its Chromium sandbox. | worker Compose files; `crawl4ai.config.yml:110-115` |
| CYB-07 | High | External knowledge reaches the model without a structural indirect-prompt-injection gate. | `packages/agent/src/ingest.ts:288-390,436-525`; `packages/agent/src/tools.ts:285-305,432-443` |
| CYB-08 | High | Release pipelines lack a complete immutable build, scan, SBOM, and provenance boundary. | release workflows and `scripts/mirror-gate/src/publish.ts` |
| CYB-09 | Medium | PDF and Office originals are retained and redistributable without active-content triage. | `packages/agent/src/extract.ts:83-105`; storage/download paths |
| CYB-10 | Medium | Newsletter confirmation links trust request host and forwarded protocol headers. | `apps/web/src/app/(marketing)/newsletter/actions.ts:46-58,86-91` |
| CYB-11 | Medium | The last Owner can leave without an atomic successor. | `packages/ops/src/organization.ts:97-109` |
| CYB-12 | Medium | Conversation retention is promised but has no duration policy or purge lifecycle. | privacy policy `:140-147`; conversations/messages schema |
| CYB-13 | Medium | Untrusted transcript content can be distilled into persistent memory and reinjected. | `packages/agent/src/memories.ts:141-190`; `agent-learnings.ts:64-137` |
| CYB-14 | Medium | Retrieval has no minimum similarity/diversity control, and embedding spaces can be mixed. | retrieval RPCs; `packages/agent/src/embeddings.ts`; embedding settings action |
| CYB-15 | Medium | Slack and ServiceNow authorization-code flows omit PKCE. | `apps/web/src/lib/application-oauth.ts:226-263,310-330` |
| CYB-16 | Medium | Self-host defaults expose HTTP listeners and do not define default-deny network zones. | `deploy/docker-compose.yml`; `deploy/gateway.conf:8-25`; `deploy/.env.example:33-42` |
| CYB-17 | Medium | Desktop/browser credential containment is incomplete. | Local Connector settings; `apps/desktop/src/main/windows.ts:91-107` |
| CYB-18 | Medium | LLM adversarial regression coverage is not merge-blocking. | `.github/workflows/ci.yml`; agent security tests |
| CYB-19 | Medium | Security-event normalization, detection-as-code, retention, and IR linkage are incomplete. | `runtime_events`, Alerts schema, cron/workflows, runbooks |
| CYB-20 | Medium | The graph embedding model is not pinned to immutable model files and verified hashes. | `services/graph-worker/Dockerfile:16-18,29-33` |

## Detailed evidence and remediation

### CYB-01: authorize before PDF parsing

`uploadFileSourceAction` materializes the upload and calls `extractSourceText`
before `ingestNewSource` reaches `requireMember("edit")`. A request that reaches
the Server Action can therefore spend parser CPU and memory before it is refused.
The action accepts bodies up to 50 MiB and the application accepts PDFs up to
25 MiB.

Move the membership check to the start of the Server Action, before `formData()`,
`arrayBuffer()`, and parsing. Add upload concurrency/rate limits and a negative
test that proves an unauthenticated request never invokes the parser.

### CYB-02: remove plaintext secret storage

`sealSecret` logs a warning and returns `plain:<secret>` when the encryption key
is missing; `openSecret` accepts that representation. The helper protects
provider, SSO, help-desk, API-integration, and application OAuth credentials.

Make startup and every secret-bearing write fail closed without a valid key.
Inventory existing `plain:` rows and require rotation or a controlled migration.

### CYB-03: use a canonical MCP backend origin

The hosted MCP handler validates a caller's Bearer key, then constructs a
`CieleClient` with `new URL(request.url).origin`. The client forwards the same
Bearer key to that origin. If a proxy permits an untrusted host/forwarded-host,
the route becomes a conditional server-side request forgery and credential
forwarding sink.

Use a required, validated internal origin. Reject unexpected host headers and
test hostile host/forwarded-host values without making egress.

### CYB-04: revoke delegated keys during offboarding

Member removal deletes the membership and assistant-access overrides, but does
not revoke `organization_api_keys`. API-key authentication checks hash,
organization, stored role, and revocation state; it does not require the creator
to remain a Member.

Revoke the creator's active keys atomically with membership removal. If service
accounts are required, model explicit ownership transfer and attestation rather
than inheriting a departed human identity.

### CYB-05: log actual sensitive-object access

Knowledge originals and analytics exports are delivered with signed URLs. The
application does not persist an event that identifies actor, organization,
object, result, IP, user agent, bytes, and request correlation. URL issuance is
not evidence that a download occurred.

Proxy sensitive downloads through an authenticated endpoint with an append-only
access ledger, or ingest equivalent provider access logs with a tested contract.
Add bulk-download, new-IP, and unusual-time detections after the base event
exists.

### CYB-06: contain local workers

The standalone worker Compose files publish `11235:11235` and `8000:8000`, which
bind to all interfaces despite comments describing localhost exposure. The
crawler configuration runs Chromium with its sandbox disabled. The graph worker
also runs as root with a build toolchain and writable root filesystem.

Bind developer ports to `127.0.0.1`, omit host ports in the integrated stack,
and add a resolved-Compose policy test. Run workers as non-root with a read-only
root filesystem, dropped capabilities, no-new-privileges, and the browser
sandbox enabled where supported.

### CYB-07: establish a trust boundary for knowledge

Website, file, URL, and application content is converted, chunked, embedded, and
returned as tool output without quarantine, trust tier, or structural instruction
boundary. A system-prompt sentence tells the model to treat documents as data,
but that is not an authorization control.

Add provenance and an activation verdict (`clean`, `review`, `rejected`) before
content becomes searchable. Delimit tool output as untrusted data, require human
confirmation for high-impact side effects, and add multilingual/Unicode indirect
prompt-injection fixtures.

### CYB-08: separate build, verify, and publish

The release surface contains four related gaps:

- third-party GitHub Actions use mutable version tags;
- the mirror gate executes the source/dependency tree while the publish PAT is
  present;
- Node, Python, containers, and Desktop have no complete SCA/SBOM gate;
- public Desktop artifacts lack a project-verifiable signature/checksum/SBOM/
  provenance chain, while OCI tags are pushed before all checks pass.

Run builds and tests without publish credentials, promote immutable artifacts by
digest in a minimal publish job, pin Actions to full SHAs, lock Python transitives
with hashes, and attach signed SBOM/provenance to every release artifact.

### CYB-09: quarantine active documents

File acceptance primarily trusts suffix and size. PDFs are parsed in-process
without page/object/decompression budgets; DOCX content is passed to Mammoth
without checking macro-enabled content types, embedded objects, DDE, ActiveX, or
external relationships. Originals can later be downloaded by administrators and,
with direct access enabled, Visitors.

Quarantine before parsing and persistence. Validate magic/structure, scan in an
isolated worker with hard resource limits, record scanner/version/hash/verdict,
and make only clean or sanitized derivatives downloadable.

### CYB-10: build email links from configured origin

`confirmUrl` accepts `Host` and `X-Forwarded-Proto` and places a signed
confirmation token in the resulting URL. A permissive proxy could cause a
legitimate email to point at an attacker origin and disclose the token.

Use a validated canonical public origin or explicit domain allowlist. Add tests
for hostile host and forwarded-protocol headers.

### CYB-11: preserve an Owner invariant

Self-leave deletes the caller's membership without verifying that another Owner
exists. Only an Owner can manage Owner-level succession.

Reject removal, demotion, or self-leave of the last Owner, or perform an atomic
handover with an audited break-glass recovery path.

### CYB-12: implement transcript retention

The privacy page says organizations control conversation retention, but the
implemented duration covers AI traces, not `conversations` and `messages`.
Manual deletion of one conversation is not a retention lifecycle.

Add an organization-scoped transcript-retention policy, legal hold semantics,
an idempotent purge/anonymization job, deletion audit, UI/API controls, and tests
for cascade and tenant isolation.

### CYB-13: prevent persistent memory injection

Memory and teammate-learning distillers receive transcript/exchange text without
marking it as untrusted or explicitly rejecting embedded commands. Accepted
model output is saved and later injected into control context for future turns.

Envelope transcript data with provenance, reject instruction/tool/persistence
content, quarantine cross-member teammate learning, and add adversarial tests
that prove injected markers are neither saved nor acted on.

### CYB-14: version and diversify retrieval

Vector queries take top-k results without a minimum similarity or per-source cap;
one Source can monopolize context. Existing chunks also lack an immutable
embedding-space identifier, so a provider/model change can compare a current
query against mixed historical spaces.

Calibrate thresholds, add per-source caps/MMR or equivalent diversity, and make
embedding changes generation-based. Persist an `embedding_space_id` and perform
an atomic full-corpus cutover.

### CYB-15: complete PKCE coverage

Slack and ServiceNow omit both authorization-request challenge fields and the
token-request verifier. State and a confidential client secret remain useful,
but do not bind an intercepted code to the initiating transaction.

Use S256 PKCE where the provider/tenant supports it. Model an explicit, tested
capability exception when a provider cannot support PKCE.

### CYB-16: make the secure self-host path the default

The default Compose publishes app and gateway ports on all interfaces and uses
HTTP origins. TLS is delegated to a later operator-managed reverse proxy. The
stack also lacks explicit default-deny network zones between ingress, app,
database, and workers.

Bind internal listeners to loopback/private networks, ship or require a validated
TLS reverse-proxy path, fail startup for public non-loopback HTTP origins, and
define explicit ingress/egress network policy.

### CYB-17: tighten Desktop and browser credential lifetime

The Local Connector Bearer token is stored indefinitely in Chromium
`localStorage`. The anonymous visitor identifier is also a long-lived history
capability. Desktop logout clears only the active persistent partition, and the
native Electron window explicitly sets `sandbox: false`.

Use short-lived, scoped connector credentials held in memory or the OS keystore;
add unpair/revocation and TTL. Replace raw visitor identity with an expiring,
Assistant-scoped capability. Clear all relevant partitions on global logout and
enable the Electron sandbox or document a tested exception.

### CYB-18: add adversarial LLM release gates

The test suite contains focused security tests, but no repeatable, merge-blocking
corpus for jailbreak, prompt injection, tool abuse, secret/PII leakage, and
memory poisoning across providers. Generated output also streams before any
provider-independent output verdict.

Add deterministic adversarial fixtures and thresholded evaluation in CI. Treat a
runtime output classifier/redactor as defense in depth after product policy and
false-positive requirements are defined; do not rely on it as the only safety
control.

### CYB-19: connect telemetry to detection and response

Runtime events focus on product/AI operations. The repository does not define a
normalized, exportable security-event contract, portable detection rules,
enforced retention, or a lifecycle that links alerts to triage and evidence
preservation. Several host/container/ransomware skills therefore collapsed into
this single operational gap.

Define a security-event schema and trusted ingestion boundary, enforce retention,
validate portable rules in CI, and add a versioned incident-response runbook with
evidence acquisition, containment, restore, and regular restore drills.

### CYB-20: pin the model artifacts as well as the libraries

The graph worker configures `sentence-transformers/all-MiniLM-L6-v2` by model
name but does not pin a repository revision or verify model/tokenizer file hashes.
Python dependency pins and an image digest do not independently identify those
model bytes.

Resolve the model during a controlled build, pin an immutable revision, verify a
signed/hash manifest fail-closed, bake the files into the final image, and record
model identity in the SBOM and index-generation metadata.

## Positive controls retained during deduplication

- Tenant and Assistant scoping is consistently applied to knowledge retrieval;
  the review did not find a static cross-tenant vector-search bypass.
- API catalog paths and egress apply strong scheme, authority, traversal, DNS,
  and redirect validation.
- SSO sessions use authenticated encryption, secure cookie attributes, state,
  nonce, and PKCE in the Entra widget flow.
- Org API keys are hashed, role-capped, and explicitly revocable.
- MCP validates Bearer authentication, and its stdio read-only switch blocks
  mutation before a request.
- Knowledge and export buckets are private and organization-scoped; signed URLs
  are short lived.
- CI already runs frozen-lockfile install, type checking, tests, lint, build,
  mirror gates, and license checks.

## Recommended order

1. Fix CYB-01 through CYB-04: authorization and credential failures.
2. Fix CYB-05 through CYB-09: access evidence, exposed workers, untrusted
   knowledge/documents, and release integrity.
3. Fix CYB-10 through CYB-17 as product-lifecycle and deployment hardening.
4. Plan CYB-18 through CYB-20 as cross-cutting security engineering work.

## Remediation status

Every finding was worked on this branch. The table says what actually landed,
in the commits that follow the one adding this document. "Partial" names what
is still open, so a green row is never a claim about work that did not happen.

| ID | Status | What landed | What is still open |
| --- | --- | --- | --- |
| CYB-01 | Done | `uploadFileSourceAction` authorizes before `extractSourceText`, with a negative test proving the parser is never entered; all three upload doors (the two console actions and `POST /api/v1/collections/{id}/sources`, keyed on the human the key delegates for) draw on one per-member window (20/10 min, `upload-limit.ts`), refused before a byte reaches the parser; the API answers 429 with `Retry-After` | The window is in-process, so serverless bounds each warm instance rather than the fleet, same trade `rate-limit.ts` already documents |
| CYB-02 | Done | `sealSecret` throws without `APP_ENCRYPTION_KEY`; a Supabase-backed process now refuses to *start* without it (`instrumentation.ts`), so the misconfiguration surfaces at deploy time, not at the next Settings form; `scripts/rotate-legacy-secrets.mjs` inventories every sealed column for `plain:` rows and re-seals them on `--rotate` | Rotation is operator-run, not scheduled; the script replicates the core seal (it cannot import TS), held together by its test |
| CYB-03 | Done | The hosted MCP endpoint resolves its internal origin from the environment, never the request; loopback default keeps it configuration-free. In Vercel production the canonical public origin wins over `VERCEL_URL`, because the deployment URL sits behind Deployment Protection and answers with an SSO page instead of the API; `CIELE_INTERNAL_API_ORIGIN` is the override when protection covers the domain too | |
| CYB-04 | Done | Removal and self-leave revoke the member's keys before the membership row goes; `/api/v1` auth also refuses a key whose creator is gone, and caps every key at its creator's *current* role at auth time, so a demotion re-caps what they minted without a second stored copy of the fact | |
| CYB-05 | Done | `object_access_events`, append-only and service-role-write (the admin-only read and the absence of any write policy are asserted as `authenticated` in `ledger-access.security.test.ts`); both download paths proxy the bytes and record actor, result, byte count, IP, user agent and request id. A client cancel is its own outcome, `aborted`, with the bytes that moved, and the bulk-download rule counts it beside `served`: `failed` is reserved for our side breaking | Bulk-download, refusal-probe and new-address-per-actor detections landed with CYB-19. An anonymous Visitor's actor id is caller-supplied, so it correlates a browser's downloads and is not an identity. The widget download route bounds refused probes (30/10 min per address) so an anonymous loop cannot grow the append-only ledger without limit |
| CYB-06 | Partial | Worker ports bind to `127.0.0.1`, `no-new-privileges` on both, graph worker runs as uid 10001 with no compiler in the runtime image, capabilities dropped | Read-only root filesystem untested (cognee's write paths are not proven); the Chromium sandbox stays off |
| CYB-07 | Partial | Per-turn fence (CSPRNG nonce) around every string a tool returns: search results, both windowed readers, and a text API body. A policy paragraph naming the fence, and a regex signal scanner (`packages/agent/src/untrusted-content.ts`): override phrasing in nine languages, role, tool, persistence and exfiltration phrasing in the seven Latin-script languages the product answers in, plus zero-width and bidi Unicode. A tool request is a call verb followed by the tool identifier (`send_email`, `api_request`, `handover`), or an imperative call verb followed by a tool noun qualified as email, API or handover ("the email tool", "l'outil de messagerie"), so "use the tool in the menu" stays clean and "call the email tool now" does not; a persistence request is a memory verb addressed at the reader with a forever phrase that closes the clause, or the colon form ("merk dir für immer: …"); an exfiltration is a send verb, a secret noun and a destination, where a destination is an address, a URL, a pronoun or a named recipient. Every rule is held by a per-sentence corpus in `untrusted-content.security.test.ts`, known over-refusals listed by name. It catches the phrasings it names, not paraphrases, which is why the fence is the boundary and the scan an annotation | No ingest-time activation verdict, so content is fenced at read time rather than quarantined at write time. No human-confirmation gate for high-impact side effects, which the remediation paragraph asks for by name. A parsed-JSON API body is not fenced (it would stop being a structure); the policy paragraph says the rule holds for it anyway |
| CYB-08 | Partial | Every third-party action pinned to a commit SHA, enforced by `scripts/workflow-pins.test.mjs`; the OSS release now has a credential boundary: assemble+gate runs with no publish token in scope, and only `mirror-gate push`, which executes nothing but git over the prepared clone, sees the PAT | No digest promotion for OCI images (tags still pushed by the same job that builds), no SBOM, no provenance |
| CYB-09 | Partial | Every file door persists the verdict, the `/api/v1` upload included. `triageDocument` checks magic bytes against the claimed extension, refuses executables, and reads an OOXML package's central directory to refuse macros and embedded objects wherever in the archive they sit; PDFs get a 2000-page budget, and Office packages a 256 MiB decompression budget enforced over the central directory's *declared* sizes, before a byte is inflated (a ZIP64 size sentinel is refused as unreadable). The verdict is now persisted on the Source (`config.triage`): scanner, rule-set version, sha256 of the exact bytes the parser read, and when, so a rule bump names which Sources predate it | No isolated scanner process. Refused files never become Sources, so only `clean` is recorded; pre-existing Sources carry no verdict |
| CYB-10 | Done | Mailed links use a configured origin or an allowlisted host; an unrecognised `Host` sends no email | |
| CYB-11 | Done | The last Owner cannot be removed, demoted, or leave. A deferred constraint trigger holds the same invariant under concurrency, where the operations-layer check alone is check-then-act | No break-glass recovery path |
| CYB-12 | Partial | `transcript_retention_days` + `delete_expired_conversations` + legal hold, swept nightly beside the trace policy; the clock is last activity (`updated_at`), so a thread still in use is never expired by its opening date; a Settings control for the window; a Place / Release legal hold button on the Inbox conversation's Retention card, beside the `/api/v1` and CLI routes; every tick writes a durable audit row (`retention_sweep_events`, append-only, admin-read, asserted as `authenticated`), failures and zero-ticks included, and an audit hiccup never reports a completed deletion as failed. Every new column and RPC is read with a schema-lag fallback, so the deploy serves against the pre-#801 schema until the migrate job runs (`schema-lag.test.ts`) | Deletion only, no anonymization. The audit has no console reader yet |
| CYB-13 | Partial | Both distillers fence the transcript they read and refuse to persist content carrying instruction, tool, persistence or exfiltration signals, in en/es/pt/fr/de/it/nl (the four non-override rule sets were English-only until the round-1 review; "recuérdalo para siempre" is now refused, with one fixture per language per rule; round 3 restored the natural-language tool request, a call verb followed by the identifier or by an email/API/handover-qualified tool noun in the same seven languages, after round 2's anchor on the identifier alone had let "call the email tool now" through). The scanner names phrasings, not meanings: a paraphrase it has no fixture for persists. Persistence is stricter than retrieval on purpose: a page saying "ignore all previous instructions" is answerable from, a memory saying it is a standing order | Cross-member teammate learning is not separately quarantined. Cyrillic and CJK phrasings are covered for override only |
| CYB-14 | Partial | A 0.15 cosine floor; a three-hits-per-**Source** cap applied after hydration, backfilled from a real over-fetch (the interim window is the fetch limit, so the cap can only remove, contract-tested on both implementations); and every chunk now carries its `embedding_space` (`provider:model`, stamped at embed time), with the three vector matchers refusing a cross-space comparison, pglite-tested against the real RPCs | Legacy null-space rows are treated as the current space until re-embedded (excluding them would blank existing corpora); no automated full-corpus cutover job, re-embedding is the #312 backfill path. The floor is a noise gate rather than the calibrated relevance threshold the paragraph asks for |
| CYB-15 | Done | One PKCE table both request halves read; ServiceNow gains S256, Slack is an argued exception | |
| CYB-16 | Done | Every published port binds to `${BIND_ADDRESS:-127.0.0.1}`, Studio is loopback-only regardless; the stack now sits in three explicit zones (`data`, `backend`, `workers`) where reachability is network membership: the app plane cannot open a socket to Postgres, and a worker rendering untrusted pages reaches only the app. Memberships pinned by `deploy/compose.test.mjs`. The TLS path ships: the `docker-compose.tls.yml` overlay runs Caddy on 80/443 (ACME, two hostnames, `bootstrap.sh --tls`, which checks the two names are in `.env` and exits 2 otherwise), the one deliberately public listener, pinned by the same contract test. And the app refuses to start: a production build whose public origin is `http://` on a non-loopback host throws in `instrumentation.ts` unless `CIELE_ALLOW_INSECURE_HTTP=1` is set (`lib/secure-origin.ts`, tested both as rule and as wiring) | Proven as configuration, not against a Docker daemon (the same caveat as CYB-06/20) |
| CYB-17 | Partial | Electron sandbox on, sign-out clears every partition, connector pairings expire after thirty days | The thirty days is client-side forgetting: the token still lives in `localStorage` rather than the OS keystore, and the connector never revokes it. The anonymous visitor identifier is unchanged |
| CYB-18 | Partial | `turbo run test:security` over the `*.security.test.ts` corpus, run in CI **without** `--affected` | The corpus is deterministic and exercises no model, which is the substance of the finding: no cross-provider evaluation, no thresholded scoring, no runtime output classifier |
| CYB-19 | Partial | Detection-as-code over the ledger (`security-detections.ts`: bulk-download over completed and aborted transfers, refusal-probe and new-address rules, pure and CI-tested; the tick pages the ledger to the 30-day horizon, 5000 rows a page, so a busy tenant's oldest baseline is not the first thing dropped), a daily cron turning findings into keyed raise-only Alerts, and a versioned incident-response runbook (`docs/runbooks/incident-response.md`) with severity ladder, evidence acquisition, containment levers and drills | No SIEM export contract, named in the runbook's known gaps. Ledger retention is now enforced: the nightly sweep purges rows past 400 days, far above the 30-day detection horizon |
| CYB-20 | Partial | Both repositories are resolved at build time at pinned revisions and carried in as verified bytes with a sha256 manifest re-checked at container start: the tokenizer/config set, and the ONNX export fastembed actually loads, pre-placed in its cache layout with `HF_HUB_OFFLINE=1` so a cache miss stops the container instead of fetching from a mutable branch. The manifest names both repositories and both revisions, and `services/graph-worker/RUNBOOK.md` §9 carries the pins, the failure modes and the upgrade procedure | Proven as configuration, not against a Docker daemon (the same caveat as CYB-06/16) |

Two caveats apply to the whole table.

This branch's checks are the repo's own: `pnpm verify` plus the new security
corpus. The container changes in CYB-06, CYB-16 and CYB-20 were not run against
a Docker daemon, so they are proven as configuration and not as a booting
stack, and the desktop change in CYB-17 was not run through a packaged build.

The table was written twice. Its first version called seven of these rows
"Done" that a review of the code against the remediation paragraphs would not
have: CYB-01 without a rate limit, CYB-02 without a startup check or an
inventory, CYB-09 without a recorded verdict, CYB-12 without a deletion audit,
CYB-17 with client-side expiry only, CYB-18 with no model in the loop. They are
corrected above. A second review moved CYB-14 and CYB-20 the same way: each
conceded a remediation sentence in its own "still open" column, which is the
table's definition of Partial. That two passes overstated rows is worth knowing
when reading any remaining "Done".

## Validation limits

This review proves code and configuration paths at the reviewed commit. It does
not prove reverse-proxy behavior, cloud IAM, provider capabilities, effective
tenant configuration, exploitability, or operational process execution. Those
claims require authorized runtime tests and organizational evidence.
