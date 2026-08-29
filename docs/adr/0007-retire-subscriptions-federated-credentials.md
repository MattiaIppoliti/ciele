# Retire subscription Provider Connections; add federated credentials

> [ADR-0015](0015-local-subscription-cli-connections.md) adds a per-Member,
> device-local Preview capability through the official Codex and Claude Code
> CLIs. It does not restore hosted subscription credentials or allow published
> Widget traffic to use a consumer subscription.

Hosted subscription Provider Connections are retired. Consumer Claude Pro/Max
and ChatGPT Plus/Pro credentials never enter the Ciele backend and never power
published Widget traffic. A personal subscription may power only its owner's
Preview **and its owner's own AI Teammate chat turns**, while that owner's
paired Mac executes the official provider CLI.

> **Amendment, 2026-08-22 (ticket #769, spec #767).** AI Teammates added a
> second internal chat surface. The surface changed, the principle did not: it
> is still the subscription's owner using it, on their machine, for their own
> turn. So the boundary names two surfaces instead of one.
>
> What stays outside it is what the rule was always protecting. Published
> Widget traffic is a stranger's turn on the organization's site. An unattended
> **Routine** run (#772) has no invoking Member at all, so there is nobody whose
> subscription it could be, and it uses Organization connections only. A
> colleague chatting with someone else's Teammate is their own turn, resolved
> against their own paired devices, never the Teammate owner's.
>
> Two halves enforce it, and it is worth naming both. The runtime decides
> *whether this kind of turn may use a subscription at all*:
> `mayUsePersonalSubscription` in `packages/agent/src/models.ts` reads the
> surface (`preview` or `teammate`) and requires an invoking Member. The host
> decides *whose subscription is on the table*:
> `resolvePersonalSubscription` in `apps/web/src/lib/personal-subscription.ts`
> resolves paired devices by the asking Member's own id, so the runtime is only
> ever offered credentials that belong to the person taking the turn.

Provider Connections now separate two axes:

- who pays: Platform plan (Ciele) or Organization-owned provider billing
- how the provider is authenticated: static API key or federated/keyless
  enterprise identity

The supported runtime connection types are:

- `platform`: Ciele-owned environment keys
- `api_key`: Organization BYOK, stored encrypted
- `federated`: Organization/tenant-billed keyless auth, with no stored secret

Legacy `subscription` rows may remain for cleanup/migration, but never resolve
to runtime credentials.

Google Vertex is the first federated runtime path because it unlocks enterprise
Google Cloud environments where API keys are not available. Anthropic WIF and
Azure OpenAI are modeled as federated config shapes so their adapters can be
added without another Provider Connection table redesign. Azure OpenAI is
represented distinctly from direct OpenAI because endpoint, deployment, tenant
identity and audience/scope are Azure-specific.
