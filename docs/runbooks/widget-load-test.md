# Widget load test

How to find out what the public widget chat sustains before a real audience does, and how to read
the answer. The script is `apps/web/scripts/load-widget-chat.mjs`; it is manual and never part of
`pnpm verify`, because every message it sends spends a model call.

## What is being tested

Four layers decide what a Visitor sees when many of them write at once. The test exercises all
four, and its report separates their outcomes so you can tell which one answered.

| Layer | Where | Refuses with | Scope |
|---|---|---|---|
| Per-caller budget | `apps/web/src/lib/widget-rate-limit.ts` | HTTP 429, `throttled` | One Visitor (12/min), one address (300/min), per assistant, per instance |
| Concurrency admission | `packages/agent/src/turn-concurrency.ts` | `error` event, `code: "busy"` | Per Organization (50) and per platform provider key (200), shared through Postgres |
| Provider capacity retry | `packages/agent/src/rate-limit-retry.ts` | `error` event, `code: "rate_limited"` | Each model call: up to 4 jittered retries, 45s of waiting at most |
| The AI SDK's own retry | `ai` | a plain `error` event | 5xx and network errors only, 2 retries |

`busy`, `rate_limited` and `throttled` are **overloads**: the system refusing on purpose, with a wait
the widget quotes to the Visitor. Anything else is a **fault**. The script fails the run when faults
exceed `LOAD_MAX_FAULT_RATE` (1% by default) and never counts an overload as one.

## Rehearse locally first

A rehearsal checks the plumbing for free. It uses the `web-demo` build (in-memory Db) and a stand-in
provider that refuses with 429 once too many calls are in flight, which is how a real key's rate
limit looks from the runtime.

1. Start the stand-in provider:

   ```bash
   FAKE_PORT=11500 FAKE_LATENCY_MS=1500 FAKE_MAX_CONCURRENT=4 node apps/web/scripts/fake-openai-provider.mjs
   ```

2. Put this in `apps/web/.env.local` (gitignored). The low limits are deliberate, so the run reaches
   every layer:

   ```bash
   OPENAI_COMPATIBLE_BASE_URL=http://localhost:11500/v1
   OPENAI_COMPATIBLE_CHAT_MODEL=fake
   CHAT_MAX_CONCURRENT_TURNS_PER_ORG=6
   CHAT_TURN_QUEUE_WAIT_MS=8000
   ```

   Remove any real provider key from that file first, or it wins the provider fallback.

3. Start `web-demo` from the Browser pane and send one message so the chat route compiles. The
   seeded assistant `Vrp47KxooVPk` is already published.

4. Run the test:

   ```bash
   LOAD_BASE_URL=http://localhost:3000 LOAD_ASSISTANT_ID=Vrp47KxooVPk \
   LOAD_VISITORS=40 LOAD_MESSAGES=3 LOAD_RAMP_MS=5000 LOAD_THINK_MS=2000 \
   LOAD_SPOOF_ADDRESSES=1 pnpm --filter @agent-hub/web load:widget-chat
   ```

The rehearsal on 2026-09-26 with exactly these settings: 120 messages, 26 answered, 94 `busy`, 0
`rate_limited`, 0 faults. The stand-in refused 42 calls with 429 and the capacity retry absorbed all
of them. The high `busy` share is the configuration, not a defect: 6 slots, turns of ~13s and an 8s
queue cannot serve 40 Visitors. That is the shape to look for, a system that says "busy" instead of
failing.

## Run against staging

Only against an assistant you own, on a deployment you are allowed to load. Never a customer's.

```bash
LOAD_BASE_URL=https://staging.example.com LOAD_ASSISTANT_ID=<id> \
LOAD_VISITORS=200 LOAD_MESSAGES=3 LOAD_RAMP_MS=60000 LOAD_THINK_MS=8000 \
LOAD_JSON=./load-200.json pnpm --filter @agent-hub/web load:widget-chat
```

Set `LOAD_ORIGIN` to one of the assistant's allowed domains if the Publication restricts them.

**One load generator is one address.** Vercel replaces `X-Forwarded-For` at its edge, so
`LOAD_SPOOF_ADDRESSES` does nothing there, and every virtual Visitor shares the generator's address
and its 300-a-minute budget per instance. Above that rate you are measuring the address budget, and
the report shows it as `throttled`. Either spread the run over several machines, or accept that the
number you get is a floor.

Start small (20 Visitors), then double until overloads appear. The interesting run is the first one
where they do.

## Reading the report

- **Faults above zero** are the finding. Group them by the `Faults` list at the end. A timeout means
  a turn outlived `LOAD_TIMEOUT_MS`; an HTTP 5xx means the function itself fell over.
- **`busy` without `rate_limited`**: our own slots ran out before the provider did. If the provider
  has headroom (its dashboard shows usage well under the limit), raise
  `CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER` or the per-Organization limit.
- **`rate_limited`**: the provider refused even after the jittered retries. Our slots admit more than
  the key sustains, so lower the platform limit until these stop, or raise the key's tier.
- **`throttled`**: the per-caller budget. Expected only when one generator stands in for many
  addresses, see above.
- **Time to first token** is what a Visitor feels. It includes the queue wait, so under overload it
  rises toward `CHAT_TURN_QUEUE_WAIT_MS` before `busy` appears.

A healthy run near capacity has no faults, a small `busy` share and a p90 time to first token under
about 10s.

## Setting the limits

The defaults (50 per Organization, 200 per platform key) are an estimate, not a measurement: a turn
makes a handful of model calls over 10–20s, so 200 turns in flight is on the order of 4k requests a
minute. Replace them with what the staging runs show, per deployment:

- `CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER` just under the concurrency at which `rate_limited`
  first appears.
- `CHAT_MAX_CONCURRENT_TURNS_PER_ORG` at the share of that one tenant may take. Several tenants on the
  platform key compete for the platform limit; this one keeps any single tenant from taking it all.
- `CHAT_TURN_QUEUE_WAIT_MS` near the p50 turn duration, so a Visitor waits about one turn for a slot
  before hearing "busy". It is capped at 60s.

Slots are leases with a 330s expiry, so a function that dies mid-turn frees its slot within about six
minutes without anything sweeping it. If the lease store is unreachable the turn runs unmetered
rather than failing: the admission fails open by design, unlike the spend gate.
