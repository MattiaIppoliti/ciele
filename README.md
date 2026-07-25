<div align="center">

# Ciele

**Build, test, and publish AI assistants that answer from your own knowledge.**

Embeddable chat widgets that answer from your organization's websites, files, and
FAQs — routed through a flow engine you control, escalated to your team when the
answer isn't there, and measured in a conversation inbox, an analytics view, and
an answer-quality tracker.

### [**Self-host it →**](https://docs.ciele.app/self-hosting/installation) &nbsp;&nbsp;·&nbsp;&nbsp; [**Try Ciele Cloud →**](https://ciele.app)

One command on your own machine, AGPL-3.0 &nbsp;&nbsp;·&nbsp;&nbsp; The same core, fully managed

<!-- Product screenshot. Drop console-light.png and console-dark.png into
     mirror/overlay/.github/readme/ (they ship at .github/readme/ in the
     mirror) and uncomment the block below. Capture them from a seeded demo
     deployment — never from a real one: the previous pair leaked a personal
     assistant description into the public repo.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme/console-dark.png">
  <img alt="The Ciele admin console" src=".github/readme/console-light.png" width="900">
</picture>
-->

</div>

## Run the whole thing in one command

```sh
git clone <this repository> && cd ciele
./deploy/bootstrap.sh
```

That generates every secret, starts the database, applies the migrations, and
boots the app. Open <http://localhost:3000> and sign up — the first account owns
its organization. Add `--seed` to start from populated demo content.

It talks to no Ciele service, and it does not have to talk to an AI vendor
either: point it at any server speaking the OpenAI chat and embeddings API — a
model runner on the same host will do — and the whole product runs offline.
[Self-hosting docs →](https://docs.ciele.app/self-hosting)

## What you get

- **Assistants** — a full editor with a live preview: welcome message, starter
  buttons, answering style, appearance, and the embed snippets to publish it.
- **Knowledge** — crawl websites, upload files, curate FAQ pairs. Answers cite
  the concept and the source they came from, never an opaque chunk of text.
- **Flows** — an authoritative router. Intent classification picks the flow, then
  its actions run in order: a fixed message is verbatim, and generative behavior
  is confined to knowledge search and the default behavior.
- **Help desks** — escalation destinations with channels, forms, availability
  windows, and ticketing integrations.
- **Operations** — a conversation inbox with transcripts and citations, an
  improvements tracker for answer quality, insights, and health alerts.
- **Multi-tenant from the first table** — organizations, members, and roles, with
  isolation enforced in the database by row-level security.

## Two editions, one core

The open-source edition in this repository is the whole product your visitors and
administrators use. **Ciele Cloud** is that same core, operated for you, with
plans, usage limits, managed single sign-on, and support. A small set of
managed-service features lives outside this tree — the
[open-core boundary](https://docs.ciele.app/self-hosting/open-core-boundary) says
exactly where the line falls.

## Documentation

Everything is at **[docs.ciele.app](https://docs.ciele.app)**. The product
documentation applies to both editions; the Open Source section covers
installation, configuration, the database, background workers, and upgrades.

## Contributing

This repository is a one-way mirror of a private development repository: releases
arrive as a single squashed commit plus a tag, and pull requests opened here are
**imported** with your authorship preserved rather than merged in place. That
changes nothing about how you open one. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); contributions are covered by the
[CLA](CONTRIBUTOR_LICENSE_AGREEMENT.md).

## License

AGPL-3.0-only. See [LICENSE](LICENSE) for the authoritative terms, including the
carve-out for the commercial edition.
