# @ciele/mcp

The ciele MCP server — let an AI agent (Claude, or any MCP client) operate
your Organization over `/api/v1`, on the SaaS or a self-hosted deployment.

Seven coarse tools, one per domain, each with an `action` discriminator:

| Tool | Actions |
|---|---|
| `ciele_identity` | deployment meta + the key's org and role |
| `manage_assistants` | list · get · create · update · delete · duplicate |
| `manage_flows` | list · get · create · update · delete · reorder |
| `manage_knowledge` | list_collections · list_sources · get_source · add_text · add_url · add_file · delete_source · recrawl · add_faq · import_faqs |
| `publish_assistant` | status · publish · unpublish · republish |
| `read_inbox` | list · get · export (always read-only) |
| `manage_improvements` | list · get · update |

The tools call the same operations the admin app runs; what a key's Role
cannot do in the app, it cannot do here (403 surfaces as a tool error).

## Configuration

Environment only — same variables as the CLI:

- `CIELE_API_KEY` (required) — mint one in **Settings → API Keys**
- `CIELE_BASE_URL` (optional) — your self-hosted origin; defaults to the SaaS
- `CIELE_MCP_READ_ONLY=1` (optional) — the agent may explore but every
  mutating action is refused before any request leaves

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
unflagged from 23.6). Packaging/publish lands with #630. A hosted remote MCP
endpoint is deliberately out of scope (spec #617).
