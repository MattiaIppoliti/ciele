# @ciele/mcp

The ciele MCP server — let an AI agent (Claude, or any MCP client) operate
your Organization over `/api/v1`, on the SaaS or a self-hosted deployment.

Fourteen coarse tools, grouped by domain, each with an `action` discriminator:

| Tool | Actions |
|---|---|
| `ciele_identity` | deployment meta + the key's org and role |
| `manage_assistants` | list · get · create · update · delete · duplicate · get_entities · set_entities |
| `manage_flows` | list · get · create · update · delete · reorder |
| `manage_knowledge` | list_collections · list_sources · get_source · add_text · add_url · add_file · delete_source · recrawl · add_faq · import_faqs |
| `publish_assistant` | status · publish · unpublish · republish |
| `read_inbox` | list · get · export · pin · unpin · feedback · message_feedback · delete |
| `manage_improvements` | list · get · update |
| `manage_entities` | list · get · create · update · delete · list_records · query_records · import_records |
| `manage_memories` | settings · enable · disable · subjects · list · delete · wipe |
| `manage_sso` | status · set_identity · validate · connection · connect · disconnect |
| `manage_help_desks` | Help Desk, channel ordering, and ServiceNow lifecycle |
| `manage_configuration` | Skills · Assistant Skill selection · Goals · Alerts |
| `manage_organization` | Organization · Members · Invites · API keys |
| `manage_integrations` | Assistant API integrations · Provider Connections · embedding selection |

The tools call the same operations the admin app runs; what a key's Role
cannot do in the app, it cannot do here (403 surfaces as a tool error).

## Configuration

Environment only — same variables as the CLI:

- `CIELE_API_KEY` (required) — mint one in **Settings → API Keys**
- `CIELE_BASE_URL` (optional) — your self-hosted origin; defaults to the SaaS
- `CIELE_MCP_READ_ONLY=1` (optional) — the agent may explore but every
  mutating action is refused before any request leaves
- `CIELE_MCP_MODERN_ONLY=1` (optional) — refuse 2025-era clients (see
  **Protocol era** below)

## Protocol era

The server speaks the `2026-07-28` revision — the stateless one: no
`initialize` handshake, no session id, `server/discover` instead. It **also**
serves the 2025-era handshake, so a client that has not moved yet keeps
working; the era is decided per connection from the opening exchange.

`CIELE_MCP_MODERN_ONLY=1` refuses the 2025 opening with an
unsupported-protocol-version error. Leave it unset for now: as of 2026-08 no
widely-deployed client negotiates the modern era by default, so setting it
makes the server unreachable for most.

## Claude Code

```bash
# SaaS
claude mcp add ciele -e CIELE_API_KEY=ciele_sk_… -- node <repo>/packages/mcp/bin/ciele-mcp.mjs

# Self-hosted, read-only
claude mcp add ciele \
  -e CIELE_API_KEY=ciele_sk_… \
  -e CIELE_BASE_URL=https://ciele.your-campus.example \
  -e CIELE_MCP_READ_ONLY=1 \
  -- node <repo>/packages/mcp/bin/ciele-mcp.mjs
```

## Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "ciele": {
      "command": "node",
      "args": ["<repo>/packages/mcp/bin/ciele-mcp.mjs"],
      "env": {
        "CIELE_API_KEY": "ciele_sk_…",
        "CIELE_BASE_URL": "https://ciele.your-campus.example",
        "CIELE_MCP_READ_ONLY": "1"
      }
    }
  }
}
```

The bin runs the TypeScript sources via Node's type stripping (Node ≥ 22.6;
unflagged from 23.6). Packaging/publish lands with #630.

## Or skip the install: the hosted endpoint

Every deployment also serves these same tools over HTTP at `/api/mcp`, so a
client that speaks Streamable HTTP needs no local process at all:

```bash
claude mcp add --transport http ciele https://platform.ciele.app/api/mcp \
  --header "Authorization: Bearer ciele_sk_…"
```

Point it at your own origin for a self-hosted deployment — the route ships
inside the web app, so it is there without configuration. Authentication is the
same org API key, and the key's Role is the **only** permission boundary: mint a
**Viewer** key to get a read-only agent remotely.

> `CIELE_MCP_READ_ONLY` and `CIELE_MCP_MODERN_ONLY` configure *this local
> process*. Setting them on a web container does nothing at all — it is not an
> error, it is simply ignored, so do not rely on either to restrict the hosted
> endpoint. Use the key's Role.

The endpoint serves both protocol eras (#702).
