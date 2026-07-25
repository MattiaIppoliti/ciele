# Multi-provider AI runtime with typed Provider Connections; subscriptions restricted to Preview

> Superseded in part by [ADR-0007](0007-retire-subscriptions-federated-credentials.md): hosted
> consumer subscription Provider Connections are retired; federated credentials replace the
> keyless-enterprise-auth use case.

The chat runtime is multi-provider (Anthropic, OpenAI, Google) behind a single abstraction (Vercel AI SDK). Each Organization configures Provider Connections of three types: **Platform plan** (models bundled with the product, our keys), **Subscription** (a Member's personal Claude Pro/Max or ChatGPT Plus/Pro via the providers' OAuth programs), and **API key** (BYOK, stored encrypted). Each Assistant selects the provider+model it runs on.

**Boundary decision:** Subscription connections serve only admin Preview traffic, used by the Member who connected them. Published widget traffic (anonymous end users on customer websites) runs exclusively on Platform or API-key connections. Rationale: provider OAuth subscription programs cover personal use by the subscription owner; routing production end-user traffic through a personal plan violates ToS and hits personal rate limits.

**Rejected:** letting end users attach their own consumer subscriptions inside the widget (no official provider support for third-party embedded use), and running published widgets on a Member's subscription (ToS + rate limits).
