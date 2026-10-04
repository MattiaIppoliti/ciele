# Deploy Teammate execution

See [the design and supported protocol profile](../teammate-execution.md) before provisioning.
All registries and credentials are server-only. Existing installs default to native execution
with internet, computer and messaging capabilities disabled.

## Database

Apply `supabase/migrations/20261003193500_teammate_runtime.sql` with the normal migration runner.
It adds admin-governed `teammates.runtime_config`, protected group `runtime_state`, and a
service-only atomic merge RPC. Run it before serving the new runtime settings. No production
migration is performed by the implementation task.

## Computers

Use a dedicated Docker host for computers. The supervisor can create containers and volumes;
access to its socket is privileged. Choose a short namespace (lowercase DNS label, at most
13 characters) and two different secrets:

```sh
openssl rand -hex 32  # CIELE_COMPUTER_SUPERVISOR_TOKEN
openssl rand -hex 32  # CIELE_COMPUTER_TOKEN
```

Copy those values into the private deployment `.env`. Set `CIELE_COMPUTER_NAMESPACE=ciele`.
Images are pinned to OpenBot commit `b6932d31a8d6e7896c15139dfc27a6c6911deb27`; the supervisor
build patches child authentication to a per-Teammate HMAC and fails if the reviewed contract changes.
MIT notices for OpenBot and the derived OpenDots deployment are retained in `deploy/computers/`.

Build from `deploy/`:

```sh
docker compose --env-file .env -f docker-compose.computers.yml --profile build-computers build computer-image computer-supervisor
```

For a host-run app, start the supervisor with that file and configure the app server:

```dotenv
CIELE_COMPUTER_SUPERVISOR_URL=http://127.0.0.1:4312
CIELE_COMPUTER_SUPERVISOR_TOKEN=YOUR_SUPERVISOR_SECRET
CIELE_COMPUTER_TOKEN=YOUR_DIFFERENT_MASTER_SECRET
CIELE_COMPUTER_NAMESPACE=ciele
```

For the Compose app, append `docker-compose.computers.yml:docker-compose.computers-app.yml`
to the existing `COMPOSE_FILE` after `docker-compose.yml`, then run `docker compose up -d`.
The overlay uses private service DNS and removes the supervisor's host port. Computer containers
join `ciele-computers`, separate from the database, gateway and supervisor-control network. Their
workspace/browser volumes survive container stop/start. Optional `COMPUTER_RUNTIME=runsc`
requires gVisor on the host. Default per-computer memory is 2 GiB; set a host-level resource and
egress policy appropriate to the number of active Teammates.

In Ciele, an admin opens **Teammate → Configure → Execution**, enables the required capabilities,
and saves. Browser requires internet; terminal requires internet and files. Writes require an edit
capability ceiling. The computer starts on first use; **Check computer**, **Start** and **Stop**
provide lifecycle controls. These controls are not a remote desktop viewer.

Smoke test with a Teammate using the Ciele harness:

1. Ask it to visit a public page, inspect it and report a cited/linked observation.
2. Ask it to write a marker file in its workspace and read it back.
3. Ask it to run `pwd` and list its workspace. Confirm the transcript names computer operations.
4. Stop/start the computer and read the marker again; check that its browser profile survives.
5. Repeat with a second Teammate and confirm that it cannot read the first marker.
6. Start a long command, cancel the turn, and confirm the computer stops. Repeat while an admin
   revokes terminal access. Re-enable and restart only after checking the previous process stopped.

Deleting a Teammate does not delete its retained Docker volumes. Stop its computer first and use
the deployment's retention policy to remove the exact named volumes after any required export.
Do not reuse the master secret across independent deployments. Rotating it requires stopping and
recreating existing computers with the same volumes so child tokens agree with the app.

## External AG-UI harness

Set `CIELE_AG_UI_HARNESSES` on the app server. Register an AG-UI **run endpoint**, not an ordinary
model API or a model name. For example (one-line JSON when used in a dotenv file):

```json
[
  {
    "id": "research-agent",
    "name": "Research agent",
    "organizationId": "YOUR_ORGANIZATION_ID",
    "url": "https://agents.example.com/run",
    "tokenEnv": "RESEARCH_AGENT_TOKEN"
  }
]
```

Set `RESEARCH_AGENT_TOKEN` separately. Endpoint registration belongs to the deployment operator;
only its ID/name is exposed in settings. HTTPS/public destinations are required in production.
The development/preview host can explicitly allow loopback endpoints. Redirects, private-network
destinations and DNS rebinding through the app's request transport are refused. An admin selects
the harness in **Execution** and saves. Check that streamed text and external tool receipts appear,
that state survives a second turn, and that incomplete/error runs do not advance saved state.

To connect an AG-UI client to the native Ciele harness, use a Ciele API key delegated by the Member:

```sh
curl --no-buffer "https://YOUR_CIELE_ORIGIN/api/v1/teammates/YOUR_TEAMMATE_ID/ag-ui" \
  -H "Authorization: Bearer $CIELE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  --data '{"threadId":"my-thread","runId":"my-run-1","state":{},"messages":[{"id":"user-1","role":"user","content":"Hello"}],"tools":[],"context":[],"forwardedProps":{}}'
```

Use a new `runId` for each new turn; reuse it only when retrying that delivery. History and state
are restored server-side. `@ciele/client` provides `teammates.agUi(id, input, { signal })`, which
returns the raw SSE response. Runtime settings have `GET/PUT /api/v1/teammates/{id}/runtime` and
typed client methods. The PUT requires an admin-scoped key and its creator must still be an admin.

## Slack, Telegram and Microsoft Teams

Configure persistent Redis with `CIELE_CHAT_REDIS_URL`. For the self-host stack, append
`docker-compose.teammate-messaging.yml` to `COMPOSE_FILE`. Create ignored `deploy/.env.teammates`
(or set `CIELE_TEAMMATE_ENV_FILE` to an absolute private env file). Put registries and their named
credentials there; they are loaded into the app, not into computers. The overlay enables Redis
AOF persistence and publishes no Redis port. Hosted apps use an operator-provided Redis URL and
server environment variables instead. Restart the app after registry/credential changes.

Set `CIELE_CHAT_CONNECTIONS` to entries like these:

```json
[
  {
    "id": "support-slack", "provider": "slack",
    "organizationId": "YOUR_ORGANIZATION_ID", "teammateId": "YOUR_TEAMMATE_ID",
    "workspaceId": "T012345", "botTokenEnv": "SUPPORT_SLACK_TOKEN",
    "signingSecretEnv": "SUPPORT_SLACK_SIGNING_SECRET",
    "allowedChannelIds": ["slack:C012345", "slack:D012345"],
    "users": [{ "remoteUserId": "U012345", "memberId": "YOUR_CIELE_MEMBER_ID" }]
  },
  {
    "id": "support-telegram", "provider": "telegram",
    "organizationId": "YOUR_ORGANIZATION_ID", "teammateId": "YOUR_TEAMMATE_ID",
    "botTokenEnv": "SUPPORT_TELEGRAM_TOKEN", "webhookSecretEnv": "SUPPORT_TELEGRAM_WEBHOOK_SECRET",
    "allowedChannelIds": ["telegram:12345678"],
    "users": [{ "remoteUserId": "12345678", "memberId": "YOUR_CIELE_MEMBER_ID" }]
  },
  {
    "id": "support-teams", "provider": "teams",
    "organizationId": "YOUR_ORGANIZATION_ID", "teammateId": "YOUR_TEAMMATE_ID",
    "tenantId": "YOUR_ENTRA_TENANT_ID", "appIdEnv": "SUPPORT_TEAMS_APP_ID",
    "appPasswordEnv": "SUPPORT_TEAMS_APP_PASSWORD",
    "allowedChannelIds": ["YOUR_CHAT_SDK_ENCODED_TEAMS_CHANNEL_ID"],
    "users": [{ "remoteUserId": "YOUR_BOT_FRAMEWORK_USER_ID", "memberId": "YOUR_CIELE_MEMBER_ID" }]
  }
]
```

Allow-list **Chat SDK encoded channel IDs**. Slack uses `slack:CHANNEL_ID`, Telegram uses
`telegram:CHAT_ID`. For Teams use the adapter's `channelIdFromThreadId` / `encodeThreadId` with
the verified base conversation ID, service URL and conversation type. Its encoded ID includes
base64url values, so a raw Teams `19:...` ID is not sufficient. Teams mappings use the Bot
Framework sender ID, not an inferred email address. Never approve a channel/user ID from an
unverified request.

Webhook URL: `https://YOUR_CIELE_ORIGIN/api/teammates/integrations/CONNECTION_ID/PROVIDER`.

- **Slack:** install an app with chat posting and the events needed for mentions/DMs in its
  configured workspace. Set bot token/signing secret, use the webhook as the Event Subscriptions
  URL, and enable `app_mention` and the message events for the intended channel types.
- **Telegram:** provision a BotFather token, generate a separate webhook secret and call
  `setWebhook` with this URL and `secret_token` equal to the configured secret. Add intended
  user/chat IDs explicitly; bot privacy settings affect group delivery.
- **Teams:** register an Azure Bot/Teams app in the configured Entra tenant with the Microsoft
  Teams channel enabled. Set its single-tenant app ID/client secret and this messaging endpoint.
  Install its app in the intended personal/team scope. Native Bot Framework JWT verification
  remains enabled.

These are inbound Teammate conversations, separate from the existing Applications knowledge
connectors and the existing Slack Assistant integration. They do not auto-install bots or grant
memberships. Use [Chat SDK's official adapter guides](https://chat-sdk.dev/docs) for platform
registration details, scopes and current provider requirements.

Verify a DM from a mapped member, an authorized group mention and a replayed delivery. Then check
that unmapped users, another workspace/tenant, forbidden channels, revoked Members and private
Teammates in groups get no answer. Check the persisted Ciele transcript and any approval card.
Approval decisions stay in Ciele. Attachments and platform-native approval buttons are not bridged.

The handler deadline is four minutes; webhook routes declare five minutes. A queue may outlive a
single serverless invocation. For sustained autonomous conversations, use a long-lived self-host
worker or add a durable delivery worker/outbox before promising reliable long-running delivery.
Do not claim exactly-once channel posting or production readiness from local fixtures alone.
