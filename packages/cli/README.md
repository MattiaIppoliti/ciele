# @ciele/cli

The `ciele` CLI, manage your Organization from the terminal, against the
SaaS or a self-hosted deployment. Built on `@ciele/client`; every command
runs the same operations the admin app runs.

## Install

Until the first npm release, build and install the standalone tarball:

```bash
pnpm --dir packages/cli pack --pack-destination ./dist
npm install --global ./packages/cli/dist/ciele-cli-*.tgz
```

After publication, install the same artifact with
`npm install --global @ciele/cli`.

The published package contains a standalone executable; it does not require a
Ciele checkout or workspace dependencies.

## Setup

Mint an API key in **Settings → API Keys** (admin+; the key acts with the
role you give it), then:

```bash
# SaaS
ciele login --key ciele_sk_…

# Self-hosted, the base URL is remembered by login
ciele login --key ciele_sk_… --base-url https://ciele.your-campus.example

ciele whoami
ciele doctor
```

Credentials resolve in order: `--api-key` flag → `CIELE_API_KEY` env →
`~/.ciele/config.json` (written by `login`, `0600`). Base URL: `--base-url`
→ `CIELE_BASE_URL` → config → the SaaS. CI needs only the two env vars.

Every command takes `--json` for machine-readable output. Exit codes:
`0` ok · `1` server error · `2` usage/rejected input · `3` auth.

## Commands

### Assistants

```bash
ciele assistants list [--limit 20] [--all]
ciele assistants get <id>
ciele assistants create --title "Campus bot" [--nickname …] [--description …]
ciele assistants update <id> --file patch.json      # any AssistantPatch field
ciele assistants update <id> [--title …] [--answering-style …]
ciele assistants duplicate <id>        # config + flows; knowledge stays
ciele assistants delete <id> --yes
ciele assistants get-entities <id>
ciele assistants set-entities <id> --ids products,opening-hours
```

### Flows (the router)

```bash
ciele flows list <assistantId>
ciele flows get <id>                   # full router config as JSON
ciele flows create <assistantId> --name "Fees intent" [--description …]
ciele flows create <assistantId> --file flow.json   # full FlowInput body
ciele flows update <id> --enabled false
ciele flows update <id> --file patch.json           # trigger/conditions/actions
ciele flows reorder <assistantId> --ids f2,f1,f3    # Default stays last
ciele flows delete <id> --yes                       # Default behavior refuses
```

### Knowledge

```bash
ciele collections list <assistantId>
ciele sources list <collectionId>
ciele sources add-text <collectionId> --name "Handbook" --text "…"
ciele sources add-text <collectionId> --file ./handbook.txt
ciele sources add-url  <collectionId> --url https://example.edu/fees
ciele sources add-file <collectionId> --file ./syllabus.pdf
ciele sources get <id>                 # poll status: processing → ready
ciele sources recrawl <id>             # website sources only
ciele sources delete <id> --yes
ciele faqs add <collectionId> --question "When is tuition due?" --answer "October."
ciele faqs import <collectionId> --file ./faqs.csv   # question,answer per row
```

### Publish

```bash
ciele publish status <assistantId>
ciele publish create <assistantId>                  # new immutable snapshot
ciele publish restore <assistantId> <publicationId> # roll back
ciele publish remove <assistantId> --yes            # take the widget offline
```

### Inbox

```bash
ciele conversations list [--assistant <id>] [--limit 50] [--cursor …]
ciele conversations get <id>           # transcript; trace only for admin+ keys
ciele conversations export <id> [<id>…] --out export.json   # 29-field records
ciele conversations pin <id>
ciele conversations feedback <id> --text "Needs review"
ciele messages feedback <messageId> --value -1
ciele conversations delete <id> --yes
```

### Improvements

```bash
ciele improvements list
ciele improvements get <id>
ciele improvements update <id> --status in_progress --priority high \
  --assignee <userId> --due 2026-09-01 --tags billing,urgent
# --priority none / --assignee "" / --due "" clear the field
```

### Entities, Records, and long-term memory

```bash
ciele entities list
ciele entities create --file entity.json
ciele entities update <id> --name "Orders"
ciele entities delete <id> --yes
ciele records list <entityId> [--limit 50] [--offset 0]
ciele records query <entityId> --file query.json
ciele records import <entityId> --file records.csv

ciele memories status
ciele memories enable                         # admin+ key
ciele memories subjects
ciele memories list <subjectId>
ciele memories delete <memoryId> --yes
ciele memories wipe <subjectId> --yes         # complete subject erasure

ciele sso status
ciele sso identity email                      # admin+; resets validation
ciele sso identity none                       # clear the identity claim
ciele sso validate                            # admin+; restore valid status
```

### Help desks, reusable configuration, and alerts

```bash
ciele help-desks list
ciele help-desks create --name "Student services" [--description "…"]
ciele help-desks add-channel <deskId> --file channel.json
ciele help-desks reorder-channels <deskId> --ids channel-a,channel-b
ciele help-desks connect-servicenow <deskId> --file servicenow.json

ciele skills list
ciele skills create --file skill.json
ciele assistants set-skills <assistantId> --ids skill-a,skill-b
ciele goals list <assistantId>
ciele goals create <assistantId> --file goal.json
ciele alerts list
ciele alerts resolve <alertId>
```

### Organization, access, SSO, and providers

```bash
ciele organization get
ciele organization update --file organization-patch.json
ciele members list
ciele members set-role <userId> --role editor
ciele members remove <userId> --yes
ciele invites list
ciele invites create --role viewer [--email person@example.edu]
ciele api-keys list
ciele api-keys create --name automation --role editor  # secret shown once

ciele sso connection
ciele sso connect --file entra-connection.json
ciele sso disconnect --yes
ciele providers list
ciele providers create-api-key --file provider.json
ciele providers create-compatible --file provider.json
ciele providers create-federated --file provider.json
ciele providers set-embedding <connectionId|auto>
ciele api-integrations get <assistantId>
ciele api-integrations set <assistantId> --file integration.json
```

## Running from the monorepo

`node packages/cli/bin/ciele.mjs …`: the bin runs the TypeScript sources
via Node's type stripping (Node ≥ 22.6; unflagged from 23.6). `pnpm --filter
@ciele/cli build` produces the same standalone executable shipped to npm.
