# Retire subscription Provider Connections; add federated credentials

> [ADR-0015](0015-local-subscription-cli-connections.md) adds a per-Member,
> device-local Preview capability through the official Codex and Claude Code
> CLIs. It does not restore hosted subscription credentials or allow published
> Widget traffic to use a consumer subscription.

Hosted subscription Provider Connections are retired. Consumer Claude Pro/Max
and ChatGPT Plus/Pro credentials never enter the Ciele backend and never power
published Widget traffic. A personal subscription may power only its owner's
Preview while that owner's paired Mac executes the official provider CLI.

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
