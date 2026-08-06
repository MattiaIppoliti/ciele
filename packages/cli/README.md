# @ciele/cli

The `ciele` CLI — manage your Organization from the terminal, against the
SaaS or a self-hosted deployment. Built on `@ciele/client`; every command
runs the same operations the admin app runs.

## Setup

Mint an API key in **Settings → API Keys** (admin+; the key acts with the
role you give it), then:

```bash
# SaaS
ciele login --key ciele_sk_…

# Self-hosted — the base URL is remembered by login
ciele login --key ciele_sk_… --base-url https://ciele.your-campus.example

ciele whoami
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
ciele assistants update <id> [--title …] [--answering-style …]
ciele assistants duplicate <id>        # config + flows; knowledge stays
ciele assistants delete <id> --yes
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

### Inbox (read-only)

```bash
ciele conversations list [--assistant <id>] [--limit 50] [--cursor …]
ciele conversations get <id>           # transcript; trace only for admin+ keys
ciele conversations export <id> [<id>…] --out export.json   # 29-field records
```

### Improvements

```bash
ciele improvements list
ciele improvements get <id>
ciele improvements update <id> --status in_progress --priority high \
  --assignee <userId> --due 2026-09-01 --tags billing,urgent
# --priority none / --assignee "" / --due "" clear the field
```

## Running from the monorepo

`node packages/cli/bin/ciele.mjs …` — the bin runs the TypeScript sources
via Node's type stripping (Node ≥ 22.6; unflagged from 23.6). A build step
ships with the packaging slice (#630).
