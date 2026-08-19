# Connecting AI clients to ciele

Wire the ciele MCP server into your coding agent or AI client so it can operate
your Organization, list assistants, edit Flows, feed the knowledge base,
publish, review the Inbox. Works identically against the SaaS and a self-hosted
deployment. Architecture: [`connections.md`](connections.md) · tool reference:
[`packages/mcp/README.md`](../../packages/mcp/README.md).

## Before you start

1. **Mint an API key**: admin console → *Settings → API Keys* (admin+). The key
   acts with the Role you give it, mint a **viewer** key for read-only agents,
   **editor** for content work, **admin** for publish/delete. The secret
   (`ciele_sk_…`) is shown once.
2. **Know your three variables**: every client below uses the same trio:

   | Variable | Value |
   |---|---|
   | `CIELE_API_KEY` | the key (required) |
   | `CIELE_BASE_URL` | your deployment origin; omit for the SaaS |
   | `CIELE_MCP_READ_ONLY` | `1` to refuse every mutation (recommended first run) |

3. **The server command** is `node <repo>/packages/mcp/bin/ciele-mcp.mjs`
   (Node ≥ 22.6). Replace `<repo>` with your checkout path in every snippet.

> Safety default: start with `CIELE_MCP_READ_ONLY=1` and a viewer-role key.
> Widen only when you trust the agent's workflow, the two guards are
> independent (the Role is enforced server-side, read-only inside the MCP
> process before any request leaves).

## Claude Code

```bash
claude mcp add ciele \
  -e CIELE_API_KEY=ciele_sk_… \
  -e CIELE_BASE_URL=https://ciele.your-campus.example \
  -e CIELE_MCP_READ_ONLY=1 \
  -- node <repo>/packages/mcp/bin/ciele-mcp.mjs
```

Omit `CIELE_BASE_URL` for the SaaS. Verify with `/mcp`, the `ciele` server
should list 7 tools; ask the agent to call `ciele_identity` first.

## Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

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

## Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "ciele": {
      "command": "node",
      "args": ["<repo>/packages/mcp/bin/ciele-mcp.mjs"],
      "env": {
        "CIELE_API_KEY": "ciele_sk_…",
        "CIELE_BASE_URL": "https://ciele.your-campus.example"
      }
    }
  }
}
```

Enable it under *Settings → MCP*. Cursor asks per tool call unless you allow
the server; keep confirmation on for mutating tools.

## VS Code / GitHub Copilot

`.vscode/mcp.json`: the `inputs` block keeps the secret out of the file and
out of git; VS Code prompts once and stores it:

```json
{
  "inputs": [
    { "id": "ciele-key", "type": "promptString", "password": true,
      "description": "ciele API key (Settings → API Keys)" }
  ],
  "servers": {
    "ciele": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo>/packages/mcp/bin/ciele-mcp.mjs"],
      "env": {
        "CIELE_API_KEY": "${input:ciele-key}",
        "CIELE_BASE_URL": "https://ciele.your-campus.example"
      }
    }
  }
}
```

Copilot Chat (Agent mode) picks the tools up after *MCP: List Servers → Start*.

## OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.ciele]
command = "node"
args = ["<repo>/packages/mcp/bin/ciele-mcp.mjs"]

[mcp_servers.ciele.env]
CIELE_API_KEY = "ciele_sk_…"
CIELE_BASE_URL = "https://ciele.your-campus.example"
CIELE_MCP_READ_ONLY = "1"
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json`: same shape as Claude Desktop
(`mcpServers.ciele` with `command`/`args`/`env`), then *Refresh* in the
Cascade MCP panel.

## Zed

`settings.json`:

```json
{
  "context_servers": {
    "ciele": {
      "command": {
        "path": "node",
        "args": ["<repo>/packages/mcp/bin/ciele-mcp.mjs"],
        "env": {
          "CIELE_API_KEY": "ciele_sk_…",
          "CIELE_BASE_URL": "https://ciele.your-campus.example"
        }
      }
    }
  }
}
```

## OpenCode

`opencode.json` in the project (or the global config):

```json
{
  "mcp": {
    "ciele": {
      "type": "local",
      "command": ["node", "<repo>/packages/mcp/bin/ciele-mcp.mjs"],
      "environment": {
        "CIELE_API_KEY": "ciele_sk_…",
        "CIELE_BASE_URL": "https://ciele.your-campus.example"
      }
    }
  }
}
```

## Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "ciele": {
      "command": "node",
      "args": ["<repo>/packages/mcp/bin/ciele-mcp.mjs"],
      "env": {
        "CIELE_API_KEY": "ciele_sk_…",
        "CIELE_BASE_URL": "https://ciele.your-campus.example"
      }
    }
  }
}
```

## Pi, and any other MCP-capable client

Every remaining client follows the same recipe, a **stdio MCP server** with:

- command: `node <repo>/packages/mcp/bin/ciele-mcp.mjs`
- env: `CIELE_API_KEY` (+ optional `CIELE_BASE_URL`, `CIELE_MCP_READ_ONLY`)

If the client has no MCP support at all, it can still integrate two ways:

- **Shell out to the CLI**: `ciele … --json` gives stable machine-readable
  output and distinct exit codes (`0` ok · `1` server · `2` usage · `3` auth).
- **Call `/api/v1` directly**, `Authorization: Bearer ciele_sk_…`; the full
  contract is served at `GET /api/v1/openapi.json`, discovery at
  `GET /api/v1/meta`.

## Smoke test (any client)

Ask the agent:

> Call `ciele_identity`, then list my assistants.

Expected: the deployment's `domains`, your Organization id and the key's Role,
then the assistant list. A `401` means the key is wrong or revoked; a `403`
on a mutation means the key's Role is below the operation's capability, both
are working-as-intended signals, not connection failures.
