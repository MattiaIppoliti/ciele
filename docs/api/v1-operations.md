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
| `flows.list` | member | `GET /api/v1/assistants/{id}/flows` | |
| `flows.get` | member | `GET /api/v1/flows/{id}` | |
| `flows.create` | edit | `POST /api/v1/assistants/{id}/flows` | trigger/action pairing rule (#541) |
| `flows.update` | edit | `PATCH /api/v1/flows/{id}` | pairing rule on the stored pair |
| `flows.delete` | edit | `DELETE /api/v1/flows/{id}` | Default behavior locked (409) |
| `flows.reorder` | edit | `POST /api/v1/assistants/{id}/flows/reorder` | Default pinned last by the adapter |

## Knowledge (shipped, #622)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `knowledge.collections.list` | member | `GET /api/v1/assistants/{id}/collections` | |
| `knowledge.sources.list` | member | `GET /api/v1/collections/{id}/sources` | |
| `knowledge.sources.get` | member | `GET /api/v1/sources/{id}` | status poll |
| `knowledge.sources.add` | edit | `POST /api/v1/collections/{id}/sources` | extraction + original storage at the surface; ingestion job via `enqueueIngest` port |
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

## Improvements (shipped, #625)

| Operation | Capability | Route | Beyond Db |
|---|---|---|---|
| `improvements.list` | member | `GET /api/v1/improvements` | |
| `improvements.get` | member | `GET /api/v1/improvements/{id}` | |
| `improvements.update` | edit | `PATCH /api/v1/improvements/{id}` | assignment/closure emails via `notifyImprovementUpdate` port |

Creation (`Improve Answer` flows) stays web-only for now, it fans out into
graph feedback and Suggested-Fix drafting.
