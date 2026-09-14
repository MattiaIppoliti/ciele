# /api/v1 operation catalogue

The v1-perimeter operation catalogue (#620, spec #617). One row per operation in
`@ciele/ops`; this file is the source of truth the API routes, the CLI commands
and the MCP tools all mirror. A domain slice extends this table in the same PR
that ships its operations.

**Connection architecture & diagrams**: [`connections.md`](connections.md).
**Hooking up an AI client** (Claude Code, Cursor, Copilot, Codex, …):
[`connect-ai-clients.md`](connect-ai-clients.md).

**The machine-readable contract (#626)** is `GET /api/v1/openapi.json`, built
from the endpoint registry in `apps/web/src/lib/api-v1/openapi.ts`, request
bodies render from the same zod schemas the operations validate with, and a
drift test fails CI when the registry and the route files diverge.
`@ciele/client` (packages/client) is the typed TypeScript client the CLI and
MCP server share; it mirrors the registry method-for-method.

Columns:
- **Capability**: the Role gate, identical on both surfaces
  (`member` < `edit` < `publish`/`manageMembers`/`manageApiKeys` < `changeRoles`).
- **Beyond Db**: work the operation does besides Db calls, i.e. what a thin
  HTTP wrapper must carry along (ports, jobs, sealing, storage, network).
- **Route**: the /api/v1 surface, all under key auth (#619) except where noted.

## Assistants (shipped, #620)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `assistants.list` | member | `GET /api/v1/assistants` | |
| `assistants.get` | member | `GET /api/v1/assistants/{id}` | |
| `assistants.create` | edit | `POST /api/v1/assistants` | |
| `assistants.update` | edit | `PATCH /api/v1/assistants/{id}` | |
| `assistants.delete` | publish | `DELETE /api/v1/assistants/{id}` | graph purge per Collection via the `purgeCollectionGraph` port |
| `assistants.duplicate` | edit | `POST /api/v1/assistants/{id}/duplicate` |, (multi-step Db orchestration: config, Skills, Flows) |

Not extracted (web-only for now): avatar upload (`uploadAssistantAvatarAction`,
multipart + object storage; joins the catalogue when the Files/storage story
lands in the Knowledge slice).

## Flows (shipped, #621)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `flows.catalog` | member | `GET /api/v1/flows/catalog` | reads no Db; derived from `flow-schema.ts`'s own zod enums and its pairing from `actionAllowedForTrigger`, so the catalogue cannot describe a Flow the create call would refuse |
| `flows.list` | member | `GET /api/v1/assistants/{id}/flows` | |
| `flows.get` | member | `GET /api/v1/flows/{id}` | |
| `flows.create` | edit | `POST /api/v1/assistants/{id}/flows` | trigger/action pairing rule (#541); structural config schema in `flow-schema.ts` (#837), loose on unknown keys so an older client's patch never strips a newer build's field |
| `flows.update` | edit | `PATCH /api/v1/flows/{id}` | pairing rule on the stored pair |
| `flows.delete` | edit | `DELETE /api/v1/flows/{id}` | Default behavior locked (409) |
| `flows.reorder` | edit | `POST /api/v1/assistants/{id}/flows/reorder` | Default pinned last by the adapter |
| `flows.draft` | edit | `POST /api/v1/flows/draft` | stores nothing; returns the patch after the pairing rule and the human-review gate inserted ahead of a Connector write (#841), which is the only way to see that insertion before saving |
| `flows.propose` | edit | `POST /api/v1/assistants/{id}/flows/validate` | the same, for a whole Flow |
| `flows.http.runs` | member | `GET /api/v1/flows/{id}/runs` | the inbound trigger's own record (#843); not the Inbox, because a run is not a Conversation |
| `flows.agent.thread` | member | `GET /api/v1/assistants/{id}/flows-agent/thread` | the key minter's own thread, `?flowId=` omitted means the new-Flow canvas |
| `flows.agent.conversation` | member | `GET /api/v1/assistants/{id}/flows-agent/conversations/{conversationId}` | |

## Knowledge (shipped, #622)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `knowledge.collections.list` | member | `GET /api/v1/assistants/{id}/collections` | |
| `knowledge.sources.list` | member | `GET /api/v1/collections/{id}/sources` | |
| `knowledge.sources.get` | member | `GET /api/v1/sources/{id}` | status poll |
| `knowledge.sources.add` | edit | `POST /api/v1/collections/{id}/sources` | extraction + original storage at the surface; ingestion job via `enqueueIngest` port |
| `knowledge.org.sources.add` | edit | `POST /api/v1/knowledge/sources` | resolves the org Knowledge Library, then delegates to `knowledge.sources.add`; the only add path for a caller holding an Assistant id and no Collection |
| `knowledge.sources.delete` | edit | `DELETE /api/v1/sources/{id}` | per-Concept graph retirement via `removeConceptGraph` port |
| `knowledge.faqs.create` | edit | `POST /api/v1/collections/{id}/faqs` | OKF persist via `persistFaq` port |
| `knowledge.faqs.import` | edit | `POST /api/v1/collections/{id}/faqs/import` | CSV parsing at the surface; indexed paths + CSV provenance |
| `knowledge.sources.recrawl` | edit | `POST /api/v1/sources/{id}/recrawl` | crawl restart via `restartCrawl` port |

## Publish (shipped, #623)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `publish.status` | member | `GET /api/v1/assistants/{id}/publish` | |
| `publish.publish` | publish | `POST /api/v1/assistants/{id}/publish` | snapshot build (pure); widget cache via `invalidatePublication` port |
| `publish.unpublish` | publish | `DELETE /api/v1/assistants/{id}/publish` | cache invalidation |
| `publish.republish` | publish | `POST /api/v1/assistants/{id}/republish` | cache invalidation |

## Inbox (shipped, read-only, #624)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `inbox.conversations.list` | member | `GET /api/v1/conversations` | |
| `inbox.conversations.get` | member | `GET /api/v1/conversations/{id}` | trace served only to Roles clearing the reasoning gate (#557) |
| `inbox.conversations.export-read` | member | `POST /api/v1/conversations/export` | 29-field row building at the surface; reasoning gate by Role, never a flag |

## Insights (session routes, outside `/api/v1`)

The dashboard's own reads are browser routes authenticated by the signed-in
session, not by an API key, so they are not operations and take no key:

| Route | Who | What |
|---|---|---|
| `GET /api/insights?from=&to=&aggregate=…` | any Member of the Organization | the cached overview for a filter set (five minutes per Organization and filter, ADR-0005 amendment) |
| `DELETE /api/insights` | any Member of the Organization | expires the Organization's cached overview; the next read recomputes it. Same gate as GET on purpose: the cache is shared by the roster, and a Member can already force a miss by changing a filter |

## Teammates (shipped, #768, #770, #772)

The persona and its transcript shipped with #768; governance and unattended work
did not reach `/api/v1` until this table's second half, so a key could create a
Teammate that could answer questions and do nothing else.

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `teammates.list` | member | `GET /api/v1/teammates` | visibility filter, the key acts as its minter |
| `teammates.get` | member | `GET /api/v1/teammates/{id}` | |
| `teammates.create` | edit | `POST /api/v1/teammates` | raises a `knowledge` Alert for a scope naming a deleted Collection |
| `teammates.update` | edit | `PATCH /api/v1/teammates/{id}` | same scope check on an edited scope |
| `teammates.delete` | edit | `DELETE /api/v1/teammates/{id}` | soft delete: it answers nothing more, its Conversations stay readable |
| `teammates.thread` | member | `GET /api/v1/teammates/{id}/conversations` | the *minter's* own thread, not everyone's |
| `teammates.conversation` | member | `GET /api/v1/teammates/{id}/conversations/{conversationId}` | |
| `teammates.grants.list` | member | `GET /api/v1/teammates/{id}/grants` | domains + ceiling + bypass as one governance view |
| `teammates.grants.set` | **manageMembers** | `PUT /api/v1/teammates/{id}/grants` | whole-set replace; revokes land before adds, so a half-failure holds fewer capabilities and not more |
| `teammates.routines.list` | member | `GET /api/v1/teammates/{id}/routines` | |
| `teammates.routines.create` | edit | `POST /api/v1/teammates/{id}/routines` | cap of 5, refused here with a sentence and by a trigger underneath |
| `teammates.routines.update` | edit | `PATCH /api/v1/routines/{id}` | reached through its Teammate's own edit rule |
| `teammates.routines.delete` | edit | `DELETE /api/v1/routines/{id}` | |
| `teammates.provision` | edit | `POST /api/v1/teammates/provision` | the one composite: create → grant → schedule, in that order because nothing rolls back across those tables and every partial outcome of *that* order is safe. Re-checks `manageMembers` before the grant step: surfaces check capabilities before `run`, so a composite calling an inner `run` would otherwise skip its gate |

**Channel oversight** (#778, story 15) rides the Channels domain:
`GET /api/v1/channels/oversight` and `/channels/oversight/{id}`, both
`manageMembers`. Separate paths rather than a flag on the ordinary reads,
because a flag on a read is how an oversight surface quietly becomes the default
one; `GET /channels` stays the key minter's own roster and answers `not_found`,
never "forbidden", for a channel they are not seated in.

**Console-only, and deliberately.** Each of these is a decision, not a gap, so
that nobody closes one by mistake:

| Operation | Why it has no route |
|---|---|
| `memory.me.get` / `.write` / `.revert` | The User memory layer's RLS is `member_id = auth.uid()` and nothing else, admins included, and a key acts as the Member who minted it: an endpoint would hand anyone holding the key that Member's private document. Its operations derive the member id from the context and take none as input, which is what keeps that a property rather than a promise. |
| `teammates.hide` / `.unhide` | A preference on one Member's own roster. `requireRosterOwner` refuses a key outright and says so in the message, so there is nothing for a route to call. |
| `channels.read` / `channels.mentions` | Per-Member seat state (a read marker, an unread list). Over a key they would answer for whoever minted it, which is a confusing thing for a key to do and the same objection that keeps `memory.me.*` out. |
| `channels.messages.post` | A message starts a bounded chain of model turns, which belongs to the streaming console surface rather than to a request/response API. |
| `teammates.referral.start` | The accept half of a deliberately human-mediated flow (#773): the tool emits a card and stops, and a Member clicks. A key that could accept its own referrals is the autonomous agent-to-agent chain #773 refused; that belongs to channels. |

Two more are console lifecycle rather than API surface, and they are the last
of the unexposed list:

| Operation | Why it has no route |
|---|---|
| `flows.agent.ensure` | Creates the Assistant's system Teammate as a side effect of opening the canvas. A key calling it would mint a system Teammate for a UI nobody opened. |
| `flows.agent.adopt` | Re-tags the canvas's null-tagged conversations onto the Flow a Save just created. It is a step *inside* that save, not an operation with a life of its own. |

## Projects and memory layers (shipped, #771)

Three memory layers exist; two of them reach `/api/v1`. The **User** layer does
not, and that is a decision rather than a gap: its RLS is `member_id = auth.uid()`
and nothing else, admins included, and an API key acts as the Member who minted
it, so an endpoint would hand anyone holding the key that Member's own document.
Its operations derive the member id from the context and take none as input,
which is what keeps that true rather than merely intended.

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `projects.list` | member | `GET /api/v1/projects` | |
| `projects.get` | member | `GET /api/v1/projects/{id}` | serves the row **and** its memory document with history: for a Teammate they are one thing |
| `projects.create` | edit | `POST /api/v1/projects` | |
| `projects.update` | edit | `PATCH /api/v1/projects/{id}` | `{archived:true}` is the move that keeps the record |
| `projects.delete` | edit | `DELETE /api/v1/projects/{id}` | decisions cascade, attached Teammates detach |
| `projects.document.write` | edit | `PUT /api/v1/projects/{id}/document` | whole-body replace; the previous body lands in the append-only history as `body_before`, which is what makes a revert a restore |
| `teammates.memory.get` | member | `GET /api/v1/teammates/{id}/memory` | the Agent layer with its history |
| `teammates.memory.write` | edit | `PUT /api/v1/teammates/{id}/memory` | the Teammate's own edit rule: a wrong learning is corrected by whoever maintains it |

Console-only, deliberately: `memory.me.get` / `.write` / `.revert` (the User
layer, above) and `revertMemoryDocument`, which is a console affordance on a
Member's own screen and which no route reaches.

## Improvements (shipped, #625)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `improvements.list` | member | `GET /api/v1/improvements` | |
| `improvements.get` | member | `GET /api/v1/improvements/{id}` | |
| `improvements.update` | edit | `PATCH /api/v1/improvements/{id}` | assignment/closure emails via `notifyImprovementUpdate` port |

Creation (`Improve Answer` flows) stays web-only for now, it fans out into
graph feedback and Suggested-Fix drafting.
