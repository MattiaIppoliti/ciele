# CLI & MCP connection architecture

How the `ciele` CLI, the ciele MCP server, and any script reach a deployment —
SaaS (`platform.ciele.app`) or self-hosted — and what stands between an API key
and the database. Companion pages: [`v1-operations.md`](v1-operations.md) (the
operation catalogue) and [`connect-ai-clients.md`](connect-ai-clients.md)
(per-client setup). A reviewable diagram version of this page lives in
[`plans/ciele-cli-mcp-connections/`](../../plans/ciele-cli-mcp-connections/plan.mdx).

## The stack

One path for every programmatic caller. RBAC is the key's Role; tenancy is the
org-pinned wrapper; SaaS vs self-host is only a base URL.

```mermaid
flowchart TB
    subgraph clients [Callers]
        CLI["ciele CLI<br/>(login · assistants · flows · sources ·<br/>faqs · publish · conversations · improvements)"]
        MCP["ciele MCP server<br/>(7 coarse tools · stdio · read-only switch)"]
        RAW["Your scripts / CI<br/>(curl, SDKs from openapi.json)"]
    end

    CLIENTPKG["@ciele/client — Bearer ciele_sk_… + CIELE_BASE_URL"]
    CLI --> CLIENTPKG
    MCP --> CLIENTPKG
    RAW -.HTTP.-> API

    subgraph API ["apps/web · /api/v1"]
        AUTH["auth: SHA-256 hash lookup → Organization + Role"]
        CAP["capability gate (403)"]
        VAL["zod validation (400)"]
        IDEM["Idempotency-Key replay"]
    end
    CLIENTPKG --> API

    OPS["@ciele/ops — operations layer<br/>(context, validated input) → result<br/>declares capability + mutated entities<br/>effects via ports: jobs · OKF persist · crawl · cache · emails"]
    API --> OPS

    PINNED["org-pinned Db wrapper<br/>fail-closed allow-list · org args replaced ·<br/>id args resolved → owner checked<br/>(stands in for RLS on the service-role client)"]
    OPS --> PINNED

    PG[("Postgres<br/>Supabase / self-hosted compose")]
    PINNED --> PG

    ADMIN["Admin app server actions"] --> OPS
```

Key properties, by construction:

- **The web app and the API cannot drift** — both surfaces execute the same
  operation objects from `@ciele/ops`; only context resolution differs
  (session + RLS-scoped Db vs API key + org-pinned Db).
- **A key can never out-rank its creator** — the Role is assigned at mint time,
  capped at the minting Member's Role, and every capability check reuses the
  same rank ladder as the admin app.
- **Cross-tenant access fails closed** — the org-pinned wrapper replaces
  organization arguments and resolves id-addressed rows to their owner before
  delegating; anything not allow-listed throws.

## CLI connection flow

`ciele login` validates before storing; later commands resolve credentials
flag → env → config file, so CI needs only the two env vars and a laptop never
needs them.

```mermaid
sequenceDiagram
    actor U as You
    participant CLI as ciele CLI
    participant CFG as ~/.ciele/config.json
    participant API as /api/v1 (SaaS or self-host)

    U->>CLI: ciele login --key ciele_sk_… [--base-url …]
    CLI->>API: GET /whoami (Bearer key)
    API-->>CLI: { organizationId, role, keyId }
    CLI->>CFG: save key + base URL (mode 0600)

    U->>CLI: ciele flows create <assistantId> --name "Fees intent"
    CLI->>CLI: key = --api-key → CIELE_API_KEY → config
    CLI->>API: POST /assistants/{id}/flows
    API->>API: hash → org+role · capability "edit" · zod · trigger/action rule
    API-->>CLI: 201 Flow JSON
    CLI-->>U: table (or --json) · exit 0 ok / 1 server / 2 usage / 3 auth
```

## MCP connection flow

The MCP server is a thin stdio adapter over the same client. Read-only mode is
enforced *inside the MCP process* — a refused mutation never produces network
traffic.

```mermaid
sequenceDiagram
    participant A as AI client (Claude Code, Cursor, …)
    participant M as ciele-mcp (stdio)
    participant API as /api/v1

    A->>M: initialize · tools/list
    M-->>A: 7 tools (identity, assistants, flows,<br/>knowledge, publish, inbox, improvements)
    A->>M: tools/call manage_knowledge { action: add_faq, … }
    alt CIELE_MCP_READ_ONLY=1 and the action mutates
        M-->>A: error result — refused locally, zero network
    else allowed
        M->>API: POST /collections/{id}/faqs (Bearer key)
        API-->>M: 201 · or the {error:{code,message}} envelope
        M-->>A: JSON text content (isError on failure)
    end
```

## Self-host = one variable

```mermaid
flowchart LR
    subgraph laptop [Anywhere]
        C["ciele CLI / ciele-mcp / curl"]
    end
    C -- "CIELE_BASE_URL=https://platform.ciele.app (default)" --> SAAS["SaaS"]
    C -- "CIELE_BASE_URL=https://ciele.your-campus.example" --> SELF["Self-hosted compose stack"]
    SAAS --- N1["same /api/v1, same key model"]
    SELF --- N1
```

`GET /api/v1/meta` is the version-skew answer: it lists the `domains` a
deployment actually ships, so a newer client degrades gracefully against an
older self-hosted server. The full contract is served at
`GET /api/v1/openapi.json`.
