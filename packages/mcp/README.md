# @ciele/mcp

The ciele MCP server: let an AI agent (Claude, or any MCP client) operate
your Organization over `/api/v1`, on the SaaS or a self-hosted deployment.

Seventeen tools: `ciele_identity`, plus sixteen coarse domain tools, each with
an `action` discriminator:

| Tool | Actions |
|---|---|
| `ciele_identity` | deployment meta + the key's org and role |
| `manage_assistants` | ask (the published answer + Sources; creates a Conversation) · list · get · create · update · delete · duplicate · export · import · get_access · set_access · clear_access |
| `manage_flows` | catalog · list · get · create · draft · validate · runs · agent_thread · agent_conversation · update · delete · reorder |
| `manage_knowledge` | search (passages + Sources, no answer; read-only) · list_collections · list_sources · list_org_sources · get_source · source_usage · add_text · add_url · add_file · add_org_text · add_org_url · add_org_file · set_links · set_direct_access · delete_source · recrawl · list_documents · review_document · remove_review · add_faq · add_org_faq · get_faq · update_faq · faq_history · restore_faq · check_faq_duplicates · import_faqs · import_org_faqs · export_faqs |
| `publish_assistant` | status · publish · unpublish · republish |
| `read_inbox` | list · get · export · pin · unpin · feedback · message_feedback · delete · review_list · review_get · review_decide |
| `manage_improvements` | list · get · update |
| `manage_memories` | settings · enable · disable · subjects · list · delete · wipe |
| `manage_sso` | status · set_identity · validate · connection · connect · disconnect |
| `manage_teammates` | list · get · create · update · delete · conversations · conversation · grants · set_grants · routines · add_routine · update_routine · delete_routine · memory · set_memory · provision · runtime · set_runtime · ag_ui |
| `manage_projects` | list · get · create · update · delete · set_document · list_milestones · set_milestones |
| `manage_tasks` | list · get · create · update · delete · list_comments · comment · labels · set_label |
| `manage_channels` | list · get · create · update · delete · add_member · remove_member · add_teammate · remove_teammate · oversight · oversight_read (no `post`: a message starts a chain of model turns, so it belongs to the streaming surface) |
| `manage_help_desks` | list · get · create · update · delete · add_channel · update_channel · delete_channel · reorder_channels · set_ticketing · disconnect_ticketing (the ticketing target is an Organization-owned Salesforce or ServiceNow Application Connection) |
| `manage_configuration` | Skills: skill_list · skill_create · skill_update · skill_delete · assistant_skills_get · assistant_skills_set. Goals: goal_list · goal_create · goal_update · goal_delete. Alerts: alert_list · alert_resolve. Quick Texts: quick_text_list · quick_text_create · quick_text_update · quick_text_delete. Business hours: business_hours_list · business_hours_create · business_hours_update · business_hours_delete · business_hours_timezone. Webhooks: webhook_list · webhook_create · webhook_update · webhook_pause · webhook_resume · webhook_delete · webhook_deliveries · webhook_test. Export schedules: export_schedule_list · export_schedule_create · export_schedule_update · export_schedule_delete |
| `manage_organization` | get · update · member_list · member_set_role · member_remove · invite_list · invite_create · invite_revoke · api_key_list · api_key_create · api_key_revoke · usage_meters · usage_spenders |
| `manage_integrations` | API integration: api_get · api_set · api_delete. Provider Connections: provider_list · provider_create_api_key · provider_create_compatible · provider_create_federated · provider_delete · provider_set_embedding. Applications: application_list · application_connectors · application_reconsent |

The tools call the same operations the admin app runs; what a key's Role
cannot do in the app, it cannot do here (403 surfaces as a tool error).

## Configuration

Environment only: same variables as the CLI:

- `CIELE_API_KEY` (required): mint one in **Settings → API Keys**
- `CIELE_BASE_URL` (optional): your self-hosted origin; defaults to the SaaS
- `CIELE_MCP_READ_ONLY=1` (optional): the agent may explore but every
  mutating action is refused before any request leaves
- `CIELE_MCP_MODERN_ONLY=1` (optional): refuse 2025-era clients (see
  **Protocol era** below)

## Protocol era

The server speaks the `2026-07-28` revision, the stateless one: no
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
claude mcp add --transport http ciele https://ciele.app/api/mcp \
  --header "Authorization: Bearer ciele_sk_…"
```

Point it at your own origin for a self-hosted deployment, the route ships
inside the web app, so it is there without configuration. Authentication is the
same org API key, and the key's Role is the **only** permission boundary: mint a
**Viewer** key to get a read-only agent remotely.

> `CIELE_MCP_READ_ONLY=1` on the web container makes the hosted endpoint
> refuse every mutating action, for every key, with the same words as the
> stdio server (#1135). It is a switch for the whole deployment, so to limit
> one agent on a shared one, use the key's Role or a local process.
> `CIELE_MCP_MODERN_ONLY` configures only a local process; the hosted endpoint
> always serves both eras.

The endpoint serves both protocol eras (#702).
