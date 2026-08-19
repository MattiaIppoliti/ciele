# Contributing to Ciele

Thanks for being here. Ciele is open source under
[AGPL-3.0-only](LICENSE), and contributions are welcome, with one structural
quirk you should know about before you start.

## How this repository works

Ciele is developed in a private repository and published here as a **one-way
mirror**. Each release arrives as a single squashed commit plus a tag, so this
repository's history is one commit per release and the current tree is always
authoritative.

That has one consequence for you: **pull requests are never merged here.** A
maintainer applies your patch to the private repository instead, preserving your
authorship, and it reaches this repository with the next release. Your commit
keeps your name on it, and you are credited in
[CONTRIBUTORS.md](CONTRIBUTORS.md).

Nothing about the workflow below changes because of that, open a pull request
as you normally would.

## Before you write code

- **Bugs and feature requests**: open an issue here. Include what you expected,
  what happened, and enough detail to reproduce it.
- **Anything substantial**: open an issue first and let's agree on the shape
  before you invest in the implementation. Development happens on a private
  roadmap, so a change may already be planned, in flight, or deliberately out of
  scope; a short conversation up front saves rework.
- **Security issues**: do not open a public issue. Report them privately
  through this repository's **Security → Report a vulnerability** tab.

## Local setup

```sh
pnpm install
pnpm db:start   # local Supabase
pnpm dev
```

`pnpm typecheck`, `pnpm test`, and `pnpm lint` are what CI runs, run them
before you open a pull request. `docs/` carries the architecture guide and the
ADRs; read the ADR covering the area you are touching, and `deploy/README.md`
if you are working on self-hosting.

## Opening a pull request

1. One logical change per pull request; keep unrelated cleanups separate.
2. Write code that reads like the code around it, match the existing naming,
   comment density, and structure of the files you touch.
3. Cover behavior changes with tests, next to the code, following the local
   convention.
4. Describe **why** in the description, and link the issue it resolves.
5. Green CI. The same checks gate the private import, so a red pull request
   cannot land.

## The Contributor License Agreement

Ciele also offers a commercial managed edition built from the same core, so
every pull request must be covered by our
[Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md). You keep your
copyright; you grant Ciele permission to ship your contribution under the AGPL
and in the managed edition.

Signing takes one comment: a bot posts a link on your first pull request, you
click through, and the check turns green. You only do it once. If your employer
requires a formal corporate agreement instead, open an issue titled
"Corporate CLA".

## What happens after you open a pull request

A maintainer reviews it here. Once it is approved and the CLA check is green,
your patch is applied to the private repository with your authorship intact, and
the pull request is closed with a comment naming the commit that carries it,
closed, not rejected. It ships publicly with the next release, and your name
goes into [CONTRIBUTORS.md](CONTRIBUTORS.md).
